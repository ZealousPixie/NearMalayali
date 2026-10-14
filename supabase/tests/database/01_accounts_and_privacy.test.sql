-- Stage A: accounts, profiles, visibility, discovery settings and RLS.
begin;
set search_path to public, extensions;
select plan(48);

-- Fixture users ---------------------------------------------------------------
create temp table u (name text primary key, id uuid);
grant select on u to authenticated, anon;
insert into u values
  ('alice', tests.create_user('alice@example.com')),
  ('bob',   tests.create_user('bob@example.com')),
  ('carol', tests.create_user('carol@example.com')),
  ('admin', tests.create_user('admin@example.com'));
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;

select tests.onboard(pg_temp.uid('alice'), 'alice');
select tests.onboard(pg_temp.uid('carol'), 'carol');
select tests.onboard(pg_temp.uid('admin'), 'admin_kiran');
insert into public.user_roles (user_id, role) values (pg_temp.uid('admin'), 'admin');
update public.profile_details set bio = 'Hi from Perth', occupation = 'Nurse'
 where user_id = pg_temp.uid('alice');

-- Sign-up creates every per-user row ------------------------------------------
select is((select count(*)::int from public.profiles where id = pg_temp.uid('bob')), 1, 'profile row created at sign-up');
select is((select count(*)::int from public.profile_details where user_id = pg_temp.uid('bob')), 1, 'details row created');
select is((select count(*)::int from public.profile_visibility where user_id = pg_temp.uid('bob')), 1, 'visibility row created');
select is((select count(*)::int from public.discovery_settings where user_id = pg_temp.uid('bob')), 1, 'discovery row created');
select is((select count(*)::int from public.notification_preferences where user_id = pg_temp.uid('bob')), 1, 'notification prefs created');
select ok((select not discoverable and not map_visible and not proximity_alerts
             from public.discovery_settings where user_id = pg_temp.uid('bob')),
          'discovery, map and alerts are all OFF for new accounts');

-- Anonymous callers -------------------------------------------------------------
select tests.login_as_anon();
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok(format('select public.get_profile(%L)', pg_temp.uid('alice')), '42501', null, 'anon cannot call get_profile');
select tests.logout();

-- Location table is sealed --------------------------------------------------------
select tests.login_as(pg_temp.uid('alice'));
select throws_ok('select * from public.user_locations', '42501', null, 'members cannot read user_locations');
select throws_ok($$insert into public.user_locations (user_id, location, accuracy_m)
                   values (auth.uid(), 'SRID=4326;POINT(116.1 -34.2)', 10)$$,
                 '42501', null, 'members cannot write user_locations directly');

-- Profile and detail visibility ---------------------------------------------------
select is((select count(*)::int from public.profiles where id = pg_temp.uid('bob')), 0,
          'a member who has not finished onboarding is invisible');
select is((select count(*)::int from public.profiles where id = pg_temp.uid('carol')), 1,
          'an onboarded member is visible');
select is((select count(*)::int from public.profile_details where user_id = pg_temp.uid('carol')), 0,
          'other members'' detail rows are not readable directly');
select is((select count(*)::int from public.profile_details where user_id = pg_temp.uid('alice')), 1,
          'own detail row is readable');
select tests.logout();

select tests.login_as(pg_temp.uid('carol'));
update public.profile_details set bio = 'hacked' where user_id = pg_temp.uid('alice');
select tests.logout();
select is((select bio from public.profile_details where user_id = pg_temp.uid('alice')), 'Hi from Perth',
          'members cannot edit someone else''s details');

select tests.login_as(pg_temp.uid('alice'));
select throws_ok($$update public.profiles set is_verified = true where id = auth.uid()$$,
                 '42501', null, 'members cannot verify themselves');
select throws_ok($$update public.profiles set account_status = 'active' where id = auth.uid()$$,
                 '42501', null, 'members cannot change their own account status');
select throws_ok($$update public.profiles set username = 'admin' where id = auth.uid()$$,
                 '42501', null, 'username changes must go through set_username()');
select throws_ok(format($$update public.profiles set avatar_path = '%s/x.jpg' where id = auth.uid()$$, pg_temp.uid('carol')),
                 '23514', null, 'avatar must be in the member''s own storage folder');
select lives_ok(format($$update public.profiles set avatar_path = '%s/a.jpg' where id = auth.uid()$$, pg_temp.uid('alice')),
                'avatar in own folder is accepted');
select tests.logout();

select tests.login_as(pg_temp.uid('carol'));
select is(public.get_profile(pg_temp.uid('alice')) ->> 'bio', 'Hi from Perth', 'public field visible to a stranger');
select ok(not (public.get_profile(pg_temp.uid('alice')) ? 'occupation'), 'connections-only field hidden from a stranger');
select tests.logout();

select tests.connect(pg_temp.uid('alice'), pg_temp.uid('carol'));
select tests.login_as(pg_temp.uid('carol'));
select is(public.get_profile(pg_temp.uid('alice')) ->> 'occupation', 'Nurse', 'connections-only field visible to a connection');
select tests.logout();

update public.profile_visibility set bio = 'only_me' where user_id = pg_temp.uid('alice');
select tests.login_as(pg_temp.uid('carol'));
select ok(not (public.get_profile(pg_temp.uid('alice')) ? 'bio'), '"only me" field hidden even from a connection');
select is(public.get_profile(pg_temp.uid('bob')), null, 'get_profile returns nothing for a member not yet onboarded');
select tests.logout();

-- Blocking ------------------------------------------------------------------------
select tests.login_as(pg_temp.uid('alice'));
select throws_ok(format($$insert into public.blocks (blocker_id, blocked_id) values (%L, %L)$$,
                        pg_temp.uid('carol'), pg_temp.uid('alice')),
                 '42501', null, 'cannot create a block on someone else''s behalf');
select lives_ok(format($$insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)$$, pg_temp.uid('carol')),
                'alice blocks carol');
select tests.logout();
select is((select count(*)::int from public.connections), 0, 'blocking removes the connection');

select tests.login_as(pg_temp.uid('carol'));
select is((select count(*)::int from public.profiles where id = pg_temp.uid('alice')), 0, 'blocked member cannot see the blocker''s profile');
select is(public.get_profile(pg_temp.uid('alice')), null, 'get_profile hides the blocker');
select is((select count(*)::int from public.blocks), 0, 'blocked member cannot see that they were blocked');
select tests.logout();
select tests.login_as(pg_temp.uid('alice'));
select is((select count(*)::int from public.profiles where id = pg_temp.uid('carol')), 0, 'blocker cannot see the blocked member either');
select tests.logout();

-- Onboarding ----------------------------------------------------------------------
select tests.login_as(pg_temp.uid('bob'));
select throws_ok($$select public.complete_onboarding('bobby', 'Bob', (current_date - interval '17 years')::date, '1', '1', '1')$$,
                 '22023', 'AGE_INELIGIBLE', 'under-18s are refused');
select throws_ok($$select public.complete_onboarding('Bo', 'Bob', date '1990-05-01', '1', '1', '1')$$,
                 '22023', 'USERNAME_INVALID', 'too-short username refused');
select throws_ok($$select public.complete_onboarding('support', 'Bob', date '1990-05-01', '1', '1', '1')$$,
                 '22023', 'USERNAME_RESERVED', 'reserved username refused');
select throws_ok($$select public.complete_onboarding('ALICE', 'Bob', date '1990-05-01', '1', '1', '1')$$,
                 '23505', 'USERNAME_TAKEN', 'usernames are unique regardless of case');
select throws_ok($$select public.complete_onboarding('bobby', 'Bob', date '1990-05-01', '1', '', '1')$$,
                 '22023', 'CONSENT_REQUIRED', 'consent is required');
select lives_ok($$select public.complete_onboarding(' Bobby ', 'Bob', date '1990-05-01', '2026-10', '2026-10', '2026-10')$$,
                'valid onboarding succeeds');
select is((select username from public.profiles where id = auth.uid()), 'bobby', 'username stored normalised');
select is((select count(*)::int from public.consents where user_id = auth.uid()), 3, 'three consent records stored');
select throws_ok($$select public.complete_onboarding('bobby2', 'Bob', date '1990-05-01', '1', '1', '1')$$,
                 '22023', 'ALREADY_ONBOARDED', 'onboarding cannot be repeated');

-- Discovery settings ----------------------------------------------------------------
select throws_ok($$update public.discovery_settings set map_visible = true where user_id = auth.uid()$$,
                 '23514', null, 'map visibility requires discoverability');
select throws_ok($$update public.discovery_settings set paused_until = now() + interval '60 days' where user_id = auth.uid()$$,
                 '22023', 'PAUSE_TOO_LONG', 'pause longer than 30 days refused');
select tests.logout();

-- Turning discovery off deletes the stored location.
update public.discovery_settings set discoverable = true where user_id = pg_temp.uid('bob');
insert into public.user_locations (user_id, location, accuracy_m) values (pg_temp.uid('bob'), 'SRID=4326;POINT(116.15 -34.25)', 15);
select tests.login_as(pg_temp.uid('bob'));
update public.discovery_settings set discoverable = false where user_id = auth.uid();
select tests.logout();
select is((select count(*)::int from public.user_locations where user_id = pg_temp.uid('bob')), 0,
          'switching discovery off deletes the location immediately');

-- Deactivation hides the account and clears discovery.
update public.discovery_settings set discoverable = true, map_visible = true where user_id = pg_temp.uid('bob');
insert into public.user_locations (user_id, location, accuracy_m) values (pg_temp.uid('bob'), 'SRID=4326;POINT(116.15 -34.25)', 15);
select tests.login_as(pg_temp.uid('bob'));
select public.deactivate_account();
select tests.logout();
select ok((select not discoverable and not map_visible from public.discovery_settings where user_id = pg_temp.uid('bob'))
          and not exists (select 1 from public.user_locations where user_id = pg_temp.uid('bob')),
          'deactivation switches discovery off and deletes location');

-- Roles, audit log and rate limiting ---------------------------------------------------
select tests.login_as(pg_temp.uid('alice'));
select throws_ok($$insert into public.user_roles (user_id, role) values (auth.uid(), 'admin')$$,
                 '42501', null, 'members cannot grant themselves roles');
select throws_ok($$select public.check_rate_limit('x', 1, 60)$$, '42501', null, 'rate limiter is not callable directly');
select throws_ok($$select count(*) from (select public.username_available('name' || g) from generate_series(1, 61) g) s$$,
                 'PT429', 'RATE_LIMITED', 'username checks are rate limited');
select tests.logout();

select * from finish();
rollback;
