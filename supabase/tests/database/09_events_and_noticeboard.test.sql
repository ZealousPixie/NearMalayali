-- Stage C: events, RSVPs, address and attendee privacy, reminders, noticeboard.
begin;
set search_path to public, extensions;
select plan(24);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated;
insert into u values
  ('anu', tests.create_user('anu@example.com')),
  ('biju', tests.create_user('biju@example.com')),
  ('chinnu', tests.create_user('chinnu@example.com')),
  ('deepa', tests.create_user('deepa@example.com'));
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;
select tests.onboard(pg_temp.uid(name), name) from u;
select tests.connect(pg_temp.uid('anu'), pg_temp.uid('biju'));
-- Accounts older than the noticeboard's 3-day minimum, except deepa.
update public.profiles set created_at = now() - interval '10 days' where id <> pg_temp.uid('deepa');
create temp table e (name text primary key, id uuid);
grant select, insert on e to authenticated;

select tests.login_as(pg_temp.uid('anu'));
insert into e values ('onam', public.create_event('Onam Sadya', 'Bring your appetite', now() + interval '24 hours', null,
  'Community hall', '12 Example St, Perth', 'attendees', 'Perth', null, 'public', null, 2));
insert into e values ('private', public.create_event('Committee meeting', '', now() + interval '3 days', null,
  'My place', '1 Home Rd', 'attendees', 'Perth', null, 'invite_only'));
select throws_ok($$select public.create_event('Past', '', now() - interval '2 days', null, '', '', 'attendees', '', null, 'public')$$,
                 '22023', 'EVENT_TIME_INVALID', 'events cannot start in the past');
select throws_ok($$select public.create_event('Bad link', '', now() + interval '1 day', null, '', '', 'attendees', '', 'http://x.test', 'public')$$,
                 '22023', 'EVENT_URL_INVALID', 'online links must be https');
select is((public.event_details((select id from e where name = 'onam')) ->> 'address'), '12 Example St, Perth', 'host sees the address');
select tests.logout();

select tests.login_as(pg_temp.uid('chinnu'));
select is((public.event_details((select id from e where name = 'onam')) ->> 'address'), null, 'address hidden until you are going');
select is((select count(*)::int from public.event_attendees((select id from e where name = 'onam'))), 0, 'attendee list hidden until you are going');
select is(public.event_details((select id from e where name = 'private')), null, 'invite-only events are hidden');
select throws_ok($$select * from public.events$$, '42501', null, 'events table cannot be read directly');
select lives_ok($$select public.rsvp_event((select id from e where name = 'onam'), 'going', true)$$, 'chinnu goes, hidden from the list');
select is((public.event_details((select id from e where name = 'onam')) ->> 'address'), '12 Example St, Perth', 'address shown once going');
select tests.logout();

select tests.login_as(pg_temp.uid('biju'));
select throws_ok($$select public.rsvp_event((select id from e where name = 'onam'), 'going')$$, 'PT409', 'EVENT_FULL',
                 'capacity is enforced');
select lives_ok($$select public.rsvp_event((select id from e where name = 'onam'), 'interested')$$, 'interested is still allowed');
select tests.logout();

select tests.login_as(pg_temp.uid('anu'));
select lives_ok($$select public.invite_to_event((select id from e where name = 'private'), pg_temp.uid('biju'))$$, 'host invites a connection');
select set_eq($$select display_name from public.event_attendees((select id from e where name = 'onam'))$$, array['Anu', 'Chinnu', 'Biju'],
              'host sees everyone, including hidden attendees');
select tests.logout();

select tests.login_as(pg_temp.uid('biju'));
select is((public.event_details((select id from e where name = 'private')) ->> 'my_status'), 'invited', 'invitee can see the invite-only event');
select tests.logout();

select tests.login_as(pg_temp.uid('chinnu'));
select set_eq($$select display_name from public.event_attendees((select id from e where name = 'onam'))$$, array['Anu', 'Chinnu', 'Biju'],
              'attendees see the list and themselves');
select tests.logout();

-- Reminders: once per person
select is(public.send_event_reminders(), 2, 'reminders go to the two people going');
select public.send_event_reminders();
select is((select count(*)::int from public.notifications where kind = 'event_reminder'), 2, 'running again does not duplicate reminders');

select tests.login_as(pg_temp.uid('anu'));
select public.cancel_event((select id from e where name = 'onam'));
select tests.logout();
select is((select count(*)::int from public.notifications where dedupe_key like 'evcancel:%'), 2, 'people going or interested hear about cancellation');

-- Noticeboard
select tests.login_as(pg_temp.uid('deepa'));
select throws_ok($$select public.create_notice('for_sale', 'Rice cooker', 'Lightly used, pick up only', 'Perth')$$,
                 'PT403', 'ACCOUNT_TOO_NEW', 'brand-new accounts cannot post notices');
select tests.logout();
select tests.login_as(pg_temp.uid('anu'));
select lives_ok($$select public.create_notice('accommodation', 'Room available in Joondalup', 'Vegetarian household, near the station', 'Perth', 14)$$,
                'a notice is posted');
select throws_ok($$select public.create_notice('accommodation', 'Room', 'too short', 'Perth')$$, '22023', 'NOTICE_INVALID', 'notices are validated');
select throws_ok($$select public.create_notice('jobs', 'Hiring cooks', 'Restaurant in the city is hiring', 'Perth', 90)$$,
                 '22023', 'NOTICE_EXPIRY_INVALID', 'notices last at most 60 days');
select tests.logout();
select tests.login_as(pg_temp.uid('biju'));
select is((select count(*)::int from public.list_notices(null, 'perth')), 1, 'notices are listed by region');
select tests.logout();
update public.notices set created_at = now() - interval '1 day', expires_at = now() - interval '1 hour';
select tests.login_as(pg_temp.uid('biju'));
select is((select count(*)::int from public.list_notices()), 0, 'expired notices disappear');
select tests.logout();

select * from finish();
rollback;
