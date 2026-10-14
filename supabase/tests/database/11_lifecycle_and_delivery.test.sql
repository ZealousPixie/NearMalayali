-- Stage D: deactivation, deletion, push receipts and storage cleanup.
begin;
set search_path to public, extensions;
select plan(19);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated, service_role;
insert into u values
  ('anu', tests.create_user('anu@example.com')),
  ('biju', tests.create_user('biju@example.com'));
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;
select tests.onboard(pg_temp.uid(name), name) from u;
select tests.connect(pg_temp.uid('anu'), pg_temp.uid('biju'));
create temp table ids (name text primary key, id text);
grant select, insert on ids to authenticated, service_role;

select tests.login_as(pg_temp.uid('anu'));
insert into ids values ('conv', public.start_direct_conversation(pg_temp.uid('biju'))::text);
insert into ids values ('msg', public.send_message((select id::uuid from ids where name = 'conv'), 'Hi Biju')::text);
insert into ids values ('post', public.create_post('Hello community', 'public')::text);
select tests.logout();
select tests.login_as(pg_temp.uid('biju'));
insert into ids values ('bpost', public.create_post('Biju''s post', 'public')::text);
select public.comment_on_post((select id::uuid from ids where name = 'bpost'), 'Nice one from Anu?');
select tests.logout();
select tests.login_as(pg_temp.uid('anu'));
insert into ids values ('comment', public.comment_on_post((select id::uuid from ids where name = 'bpost'), 'Anu was here')::text);
select tests.logout();

-- Deactivation hides everything, reactivation restores it
select tests.login_as(pg_temp.uid('anu'));
select public.deactivate_account();
select tests.logout();
select tests.login_as(pg_temp.uid('biju'));
select is(public.get_post((select id::uuid from ids where name = 'post')), null, 'deactivated members'' posts are hidden');
select is((select count(*)::int from public.list_conversations()), 0, 'chats with deactivated members are hidden');
select throws_ok($$select public.send_message((select id::uuid from ids where name = 'conv'), 'hello?')$$, 'PT404', 'USER_UNAVAILABLE',
                 'deactivated members cannot be messaged');
select is((select count(*)::int from public.list_connections(pg_temp.uid('biju'))), 0, 'deactivated members drop out of connection lists');
select tests.logout();
select tests.login_as(pg_temp.uid('anu'));
select public.reactivate_account();
select tests.logout();
select tests.login_as(pg_temp.uid('biju'));
select ok(public.get_post((select id::uuid from ids where name = 'post')) is not null, 'reactivation restores posts');
select is((select count(*)::int from public.list_conversations()), 1, 'and chats');
select tests.logout();

-- Deletion erases what the member wrote
delete from auth.users where id = pg_temp.uid('anu');
select is((select count(*)::int from public.profiles where id = pg_temp.uid('anu')), 0, 'profile is gone');
select is((select body from public.messages where id = (select id::bigint from ids where name = 'msg')), null, 'their messages are blanked');
select ok((select deleted_at is not null from public.messages where id = (select id::bigint from ids where name = 'msg')), 'and marked deleted');
select is((select body from public.post_comments where id = (select id::bigint from ids where name = 'comment')), '[deleted]', 'their comments are blanked');
select is((select count(*)::int from public.posts where id = (select id::uuid from ids where name = 'post')), 0, 'their posts are deleted');
select is((select count(*)::int from public.connections), 0, 'their connections are deleted');
select is((select count(*)::int from public.post_comments where post_id = (select id::uuid from ids where name = 'bpost') and deleted_at is null), 1,
          'other people''s comments are untouched');

-- Push receipts
insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[biju-phone]', pg_temp.uid('biju'), 'ios'),
                                                               ('ExponentPushToken[biju-old]', pg_temp.uid('biju'), 'android');
insert into public.notifications (user_id, kind, title, body, dedupe_key, push_status)
values (pg_temp.uid('biju'), 'follow', 'x', 'y', 'receipt-test-1', 'sent'),
       (pg_temp.uid('biju'), 'follow', 'x', 'y', 'receipt-test-2', 'sent');
insert into ids select 'n' || row_number() over (order by id), id::text from public.notifications where dedupe_key like 'receipt-test-%';
select tests.login_as_service();
select public.record_push_tickets(jsonb_build_array(
  jsonb_build_object('ticket_id', 't1', 'notification_id', (select id from ids where name = 'n1'), 'token', 'ExponentPushToken[biju-phone]'),
  jsonb_build_object('ticket_id', 't2', 'notification_id', (select id from ids where name = 'n2'), 'token', 'ExponentPushToken[biju-old]')));
select is((select count(*)::int from public.claim_receipt_batch()), 0, 'receipts are not checked straight away');
select tests.logout();
update public.push_tickets set created_at = now() - interval '20 minutes';
select tests.login_as_service();
select is((select count(*)::int from public.claim_receipt_batch()), 2, 'receipts are checked after 15 minutes');
select public.record_push_receipts('[{"ticket_id":"t1","status":"ok"},{"ticket_id":"t2","status":"error","error":"DeviceNotRegistered"}]');
select tests.logout();
select is((select push_status from public.notifications where id = (select id::bigint from ids where name = 'n1')), 'delivered',
          'an ok receipt marks the notification delivered');
select is((select push_status || ':' || push_error from public.notifications where id = (select id::bigint from ids where name = 'n2')),
          'failed:DeviceNotRegistered', 'an error receipt marks it failed with the reason');
select is((select count(*)::int from public.push_tokens where token = 'ExponentPushToken[biju-old]'), 0, 'dead devices are unregistered');

-- Orphaned media
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('chat-media', (select id from ids where name = 'conv') || '/old-unsent.jpg', pg_temp.uid('biju'), now() - interval '2 days'),
  ('post-media', pg_temp.uid('biju')::text || '/never-posted.jpg', pg_temp.uid('biju'), now() - interval '2 days'),
  ('post-media', pg_temp.uid('biju')::text || '/just-uploaded.jpg', pg_temp.uid('biju'), now());
select tests.login_as_service();
select set_eq($$select name from public.orphaned_media()$$,
              array[(select id from ids where name = 'conv') || '/old-unsent.jpg', pg_temp.uid('biju')::text || '/never-posted.jpg'],
              'only unreferenced files older than a day are cleaned up');
select tests.logout();

select * from finish();
rollback;
