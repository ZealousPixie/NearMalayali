-- Stage C: connection requests, follows and their privacy rules.
begin;
set search_path to public, extensions;
select plan(22);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated;
insert into u values
  ('anu', tests.create_user('anu@example.com')),
  ('biju', tests.create_user('biju@example.com')),
  ('chinnu', tests.create_user('chinnu@example.com')),
  ('deepa', tests.create_user('deepa@example.com'));
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;
select tests.onboard(pg_temp.uid('anu'), 'anu');
select tests.onboard(pg_temp.uid('biju'), 'biju');
select tests.onboard(pg_temp.uid('chinnu'), 'chinnu');
select tests.onboard(pg_temp.uid('deepa'), 'deepa');
update public.profile_visibility set who_can_connect = 'nobody' where user_id = pg_temp.uid('deepa');

-- Request and accept
select tests.login_as(pg_temp.uid('anu'));
select is(public.send_connection_request(pg_temp.uid('biju'), 'Hi from Perth'), 'REQUESTED', 'request is sent');
select is(public.send_connection_request(pg_temp.uid('biju')), 'ALREADY_REQUESTED', 'duplicate request is not created');
select throws_ok($$select public.send_connection_request(pg_temp.uid('deepa'))$$, 'PT403', 'NOT_ACCEPTING_REQUESTS',
                 'members who accept no requests cannot be asked');
select throws_ok($$select public.send_connection_request(pg_temp.uid('anu'))$$, 'PT404', 'USER_UNAVAILABLE',
                 'cannot connect with yourself');
select throws_ok($$insert into public.connection_requests (sender_id, recipient_id) values (pg_temp.uid('anu'), pg_temp.uid('chinnu'))$$,
                 '42501', null, 'requests cannot be inserted directly');
select tests.logout();
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('biju') and kind = 'connection_request'), 1,
          'recipient is notified once');

create temp table req as select id from public.connection_requests;
grant select on req to authenticated;
select tests.login_as(pg_temp.uid('chinnu'));
select is((select count(*)::int from public.connection_requests), 0, 'outsiders cannot see the request');
select throws_ok('select public.respond_connection_request((select id from req), true)',
                 'PT404', 'REQUEST_NOT_FOUND', 'outsiders cannot accept someone else''s request');
select tests.logout();

select tests.login_as(pg_temp.uid('biju'));
select is((select message from public.list_connection_requests('incoming')), 'Hi from Perth', 'incoming request is listed');
select lives_ok(format('select public.respond_connection_request(%s, true)',
                       (select request_id from public.list_connection_requests('incoming'))), 'recipient accepts');
select ok(public.are_connected(pg_temp.uid('anu'), pg_temp.uid('biju')), 'they are now connected');
select is((public.get_relationship(pg_temp.uid('anu')) ->> 'connected')::boolean, true, 'relationship reports connected');
select tests.logout();
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('anu') and kind = 'connection_accepted'), 1,
          'sender is told the request was accepted');

-- A reverse request auto-accepts
select tests.login_as(pg_temp.uid('chinnu'));
select is(public.send_connection_request(pg_temp.uid('anu')), 'REQUESTED', 'chinnu asks anu');
select tests.logout();
select tests.login_as(pg_temp.uid('anu'));
select is(public.send_connection_request(pg_temp.uid('chinnu')), 'CONNECTED', 'asking back accepts the pending request');

-- Connection list visibility (default: connections only)
select set_eq($$select username from public.list_connections(pg_temp.uid('biju'))$$, array['anu'],
              'a connection can see the list');
select tests.logout();
select tests.login_as(pg_temp.uid('deepa'));
select is((select count(*)::int from public.list_connections(pg_temp.uid('anu'))), 0, 'non-connections cannot see the list');

-- Follows
select lives_ok($$select public.follow_user(pg_temp.uid('anu'))$$, 'deepa follows anu');
select lives_ok($$select public.follow_user(pg_temp.uid('anu'))$$, 'following twice is harmless');
select tests.logout();
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('anu') and kind = 'follow'), 1,
          'one follow notification even when followed twice');

-- Blocking removes follows and pending requests
select tests.login_as(pg_temp.uid('biju'));
select public.send_connection_request(pg_temp.uid('chinnu'));
select tests.logout();
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('anu'), pg_temp.uid('deepa')),
                                                         (pg_temp.uid('chinnu'), pg_temp.uid('biju'));
select is((select count(*)::int from public.follows where followee_id = pg_temp.uid('anu')), 0, 'blocking removes follows');
select is((select count(*)::int from public.connection_requests
            where sender_id = pg_temp.uid('biju') and recipient_id = pg_temp.uid('chinnu') and status = 'pending'), 0,
          'blocking cancels pending requests');

select * from finish();
rollback;
