-- Stage B: proximity encounters, notifications and the push queue.
begin;
set search_path to public, extensions;
select plan(25);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated, service_role;
insert into u select n, tests.create_user(n || '@example.com') from unnest(array['anu', 'biju', 'chitra', 'deepa']) n;
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;
select tests.onboard(id, name) from u;
select tests.set_discovery(id) from u;
create function pg_temp.alerts(n text) returns int language sql stable as $$
  select count(*)::int from public.notifications where user_id = (select id from u where name = n) and kind = 'proximity' $$;

-- biju is ~150 m from where anu will report.
select tests.place(pg_temp.uid('biju'), -34.2392, 116.1459, 10, 2);

select tests.login_as(pg_temp.uid('anu'));
select is((public.report_location(-34.2406, 116.1459, 10) ->> 'alerts')::int, 1, 'reporting near another member creates an alert for me');
select tests.logout();
select is(pg_temp.alerts('anu'), 1, 'anu has one proximity notification');
select is(pg_temp.alerts('biju'), 1, 'biju is alerted too');
select is((select title || ' / ' || body from public.notifications where user_id = pg_temp.uid('biju')),
          'A fellow Malayali is nearby / Would you like to discover your community?',
          'alert text names nobody and no place');
select is((select data from public.notifications where user_id = pg_temp.uid('biju')), '{"screen": "discover"}'::jsonb,
          'alert payload carries no identity or location');

-- Repeat report: cooldown suppresses duplicates
select tests.age_location(pg_temp.uid('anu'), 1);
select tests.login_as(pg_temp.uid('anu'));
select is((public.report_location(-34.2405, 116.1459, 10) ->> 'alerts')::int, 0, 'no repeat alert within the cooldown');
select tests.logout();
select is(pg_temp.alerts('biju'), 1, 'and none for the other person either');

-- After the cooldown has passed a new alert is allowed
update public.proximity_alerts set created_at = now() - interval '13 hours';
select tests.age_location(pg_temp.uid('anu'), 1);
select tests.login_as(pg_temp.uid('anu'));
select is((public.report_location(-34.2404, 116.1459, 10) ->> 'alerts')::int, 1, 're-alert after the 12 h cooldown');
select tests.logout();

-- Reset for the remaining scenarios
delete from public.notifications;
delete from public.proximity_alerts;
delete from public.user_locations;

-- Only one side opted in: nobody is alerted
update public.discovery_settings set proximity_alerts = false where user_id = pg_temp.uid('biju');
select tests.place(pg_temp.uid('biju'), -34.2392, 116.1459, 10, 2);
select tests.login_as(pg_temp.uid('anu'));
select is((public.report_location(-34.2406, 116.1459, 10) ->> 'alerts')::int, 0, 'no alert unless both members turned alerts on');
select tests.logout();
select is(pg_temp.alerts('biju'), 0, '... in either direction');
update public.discovery_settings set proximity_alerts = true where user_id = pg_temp.uid('biju');

-- Blocked pair
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('biju'), pg_temp.uid('anu'));
select tests.age_location(pg_temp.uid('anu'), 1);
select tests.login_as(pg_temp.uid('anu'));
select is((public.report_location(-34.2405, 116.1459, 10) ->> 'alerts')::int, 0, 'blocked members never trigger alerts');
select tests.logout();
select is(pg_temp.alerts('biju'), 0, '... for either person');
delete from public.blocks;

-- The smaller of the two radii applies (chitra wants 100 m; ~300 m away)
update public.discovery_settings set alert_radius_m = 100 where user_id = pg_temp.uid('chitra');
delete from public.user_locations where user_id = pg_temp.uid('biju');
select tests.place(pg_temp.uid('chitra'), -34.2379, 116.1459, 10, 2);
select tests.age_location(pg_temp.uid('anu'), 1);
select tests.login_as(pg_temp.uid('anu'));
select is((public.report_location(-34.2406, 116.1459, 10) ->> 'alerts')::int, 0, 'the stricter of the two alert distances applies');
select tests.logout();

-- Inaccurate fixes don't trigger alerts (deepa 150 m away, but 80 m accuracy vs 500 m radius is fine;
-- 120 m accuracy is not)
select tests.place(pg_temp.uid('deepa'), -34.2392, 116.1459, 120, 2);
select tests.age_location(pg_temp.uid('anu'), 1);
select tests.login_as(pg_temp.uid('anu'));
select is((public.report_location(-34.2406, 116.1459, 10) ->> 'alerts')::int, 0, 'a low-accuracy fix on the other side does not alert');
select tests.logout();
select tests.place(pg_temp.uid('deepa'), -34.2392, 116.1459, 80, 2);
select tests.age_location(pg_temp.uid('anu'), 1);
select tests.login_as(pg_temp.uid('anu'));
select is((public.report_location(-34.2406, 116.1459, 10) ->> 'alerts')::int, 1, 'an adequate fix does alert');
select tests.logout();

-- Mocked GPS never matches
delete from public.proximity_alerts;
delete from public.notifications;
select tests.age_location(pg_temp.uid('anu'), 1);
select tests.login_as(pg_temp.uid('anu'));
select is(public.report_location(-34.2406, 116.1460, 10, true), '{"stored": true, "alerts": 0}'::jsonb,
          'a mocked location is stored (and hidden from others) but never matched');
select tests.logout();
select is(pg_temp.alerts('deepa'), 0, '... so nobody is alerted');
select tests.place(pg_temp.uid('anu'), -34.2406, 116.1459, 10, 2);
select tests.place(pg_temp.uid('deepa'), -34.2392, 116.1459, 10, 1);
select tests.login_as(pg_temp.uid('deepa'));
select public.report_location(-34.2392, 116.1459, 10);
select tests.logout();

-- Notification access --------------------------------------------------------------------
select tests.login_as(pg_temp.uid('anu'));
select is((select count(*)::int from public.notifications where user_id <> auth.uid()), 0, 'members only see their own notifications');
select throws_ok($$update public.notifications set read_at = now()$$, '42501', null, 'notifications cannot be edited directly');
select lives_ok($$select public.mark_all_notifications_read()$$, 'mark all as read');
select throws_ok($$select * from public.claim_push_batch(10)$$, '42501', null, 'members cannot drain the push queue');
select lives_ok($$select public.register_push_token('ExponentPushToken[anu-device]', 'ios')$$, 'register a push token');
select tests.logout();
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('anu') and read_at is null), 0, 'all marked read');

-- Push queue --------------------------------------------------------------------------------
-- deepa has no device -> skipped; anu has a device -> claimed.
select tests.login_as_service();
select is((select count(*)::int from public.claim_push_batch(10)), 1, 'only notifications with a device are claimed');
select tests.logout();
select is((select push_status from public.notifications where user_id = pg_temp.uid('deepa')), 'skipped',
          'no device means skipped, never "sent"');

select * from finish();
rollback;
