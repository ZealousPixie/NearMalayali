-- Stage C: direct and group messaging, message requests and media access.
begin;
set search_path to public, extensions;
select plan(29);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated;
insert into u values
  ('anu', tests.create_user('anu@example.com')),
  ('biju', tests.create_user('biju@example.com')),
  ('chinnu', tests.create_user('chinnu@example.com')),
  ('deepa', tests.create_user('deepa@example.com')),
  ('eby', tests.create_user('eby@example.com'));
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;
select tests.onboard(pg_temp.uid(name), name) from u;
select tests.connect(pg_temp.uid('anu'), pg_temp.uid('biju'));
select tests.connect(pg_temp.uid('anu'), pg_temp.uid('eby'));
update public.profile_visibility set who_can_message = 'connections_only' where user_id = pg_temp.uid('deepa');
create temp table c (name text primary key, id uuid);
grant select, insert on c to authenticated;
create temp table m (name text primary key, id bigint);
grant select, insert on m to authenticated;

-- Direct chat between connections goes straight to the inbox
select tests.login_as(pg_temp.uid('anu'));
insert into c values ('ab', public.start_direct_conversation(pg_temp.uid('biju')));
select is(public.start_direct_conversation(pg_temp.uid('biju')), (select id from c where name = 'ab'),
          'a pair has one direct chat');
insert into m values ('hello', public.send_message((select id from c where name = 'ab'), 'Namaskaram!'));
select throws_ok($$select public.send_message((select id from c where name = 'ab'), '   ')$$, '22023', 'MESSAGE_INVALID',
                 'empty messages are rejected');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values ((select id from c where name = 'ab'), pg_temp.uid('anu'), 'x')$$,
                 '42501', null, 'messages cannot be inserted directly');
select throws_ok($$select public.start_direct_conversation(pg_temp.uid('deepa'))$$, 'PT403', 'MESSAGES_RESTRICTED',
                 'connections-only members cannot be messaged by strangers');
select tests.logout();

select tests.login_as(pg_temp.uid('biju'));
select is((select body from public.messages where id = (select id from m where name = 'hello')), 'Namaskaram!', 'recipient reads the message');
select is((select unread_count from public.list_conversations()), 1, 'recipient has one unread');
select is(public.unread_message_count(), 1, 'total unread is 1');
select public.mark_conversation_read((select id from c where name = 'ab'), (select id from m where name = 'hello'));
select is(public.unread_message_count(), 0, 'marking read clears unread');
select lives_ok($$select public.react_to_message((select id from m where name = 'hello'), '🙏')$$, 'recipient reacts');
select throws_ok($$select public.react_to_message((select id from m where name = 'hello'), '💩')$$, '23514', null,
                 'only the supported reactions are allowed');
select throws_ok($$select public.delete_message((select id from m where name = 'hello'))$$, 'PT404', 'MESSAGE_NOT_FOUND',
                 'you cannot unsend someone else''s message');
select tests.logout();
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('biju') and kind = 'message'), 1,
          'recipient was notified');

-- Outsiders see nothing
select tests.login_as(pg_temp.uid('chinnu'));
select is((select count(*)::int from public.messages), 0, 'outsiders cannot read messages');
select is((select count(*)::int from public.conversations), 0, 'outsiders cannot see conversations');
select throws_ok($$select public.send_message((select id from c where name = 'ab'), 'hi')$$, 'PT404', 'CONVERSATION_NOT_FOUND',
                 'outsiders cannot post into a chat');

-- Message requests from a stranger
insert into c values ('cb', public.start_direct_conversation(pg_temp.uid('biju')));
select public.send_message((select id from c where name = 'cb'), 'one');
select public.send_message((select id from c where name = 'cb'), 'two');
select public.send_message((select id from c where name = 'cb'), 'three');
select throws_ok($$select public.send_message((select id from c where name = 'cb'), 'four')$$, 'PT403', 'REQUEST_PENDING',
                 'at most 3 messages before the request is accepted');
select tests.logout();

select tests.login_as(pg_temp.uid('biju'));
select is((select count(*)::int from public.list_conversations('requests')), 1, 'stranger chat lands in requests');
select is((select count(*)::int from public.list_conversations('active')), 1, 'and not in the inbox');
select lives_ok($$select public.respond_message_request((select id from c where name = 'cb'), true)$$, 'request accepted');
select is((select count(*)::int from public.list_conversations('active')), 2, 'accepted chat moves to the inbox');
select tests.logout();
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('biju') and dedupe_key like 'msgreq:%'), 1,
          'one request notification for three messages');

-- Blocking stops messaging
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('biju'), pg_temp.uid('chinnu'));
select tests.login_as(pg_temp.uid('chinnu'));
select throws_ok($$select public.send_message((select id from c where name = 'cb'), 'hello?')$$, 'PT404', 'USER_UNAVAILABLE',
                 'a blocked person cannot send messages');
select tests.logout();
select tests.login_as(pg_temp.uid('biju'));
select is((select count(*)::int from public.list_conversations('active')), 1, 'chats with blocked people are hidden');
select tests.logout();

-- Group chats
select tests.login_as(pg_temp.uid('anu'));
insert into c values ('g', public.create_group_conversation('Perth Malayalis', array[pg_temp.uid('biju'), pg_temp.uid('chinnu')]));
select set_eq($$select user_id from public.conversation_members where conversation_id = (select id from c where name = 'g')$$,
              array[pg_temp.uid('anu'), pg_temp.uid('biju')], 'only connections are added to a new group');
insert into m values ('g1', public.send_message((select id from c where name = 'g'), 'Onam plans?'));
select tests.logout();
-- Everything in this test shares one timestamp; make the earlier history actually earlier.
update public.messages set created_at = created_at - interval '1 minute' where conversation_id = (select id from c where name = 'g');
select tests.login_as(pg_temp.uid('anu'));
select is(public.add_conversation_members((select id from c where name = 'g'), array[pg_temp.uid('eby')]), 1, 'admin adds a connection');
select tests.logout();
update public.conversation_members set joined_at = clock_timestamp()
 where conversation_id = (select id from c where name = 'g') and user_id = pg_temp.uid('eby');

select tests.login_as(pg_temp.uid('eby'));
select is((select count(*)::int from public.messages where conversation_id = (select id from c where name = 'g') and kind <> 'system'), 0,
          'new members do not see earlier history');
select tests.logout();

select tests.login_as(pg_temp.uid('biju'));
select throws_ok($$select public.remove_conversation_member((select id from c where name = 'g'), pg_temp.uid('anu'))$$,
                 'PT403', 'NOT_ALLOWED', 'non-admins cannot remove members');
select tests.logout();

-- Unsend
select tests.login_as(pg_temp.uid('anu'));
select public.delete_message((select id from m where name = 'g1'));
select tests.logout();
select is((select body from public.messages where id = (select id from m where name = 'g1')), null, 'unsent message content is erased');

-- Private chat media
insert into storage.objects (bucket_id, name, owner)
values ('chat-media', (select id from c where name = 'ab')::text || '/photo.jpg', pg_temp.uid('anu'));
select tests.login_as(pg_temp.uid('chinnu'));
select is((select count(*)::int from storage.objects where bucket_id = 'chat-media'), 0, 'outsiders cannot read chat media');
select tests.logout();

select * from finish();
rollback;
