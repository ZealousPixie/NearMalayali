-- Stage B: location reporting, nearby list, area counts, map cells.
-- Manjimup WA is around (-34.2406, 116.1459); 0.001 deg latitude ~ 111 m.
begin;
set search_path to public, extensions;
select plan(30);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated, service_role;
insert into u
select n, tests.create_user(n || '@example.com')
  from unnest(array['anu', 'biju', 'chitra', 'deepa', 'eldho', 'faisal', 'gopi', 'hari', 'lurker']) n;
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;
select tests.onboard(id, name) from u;

-- anu is the viewer. Everyone else is discoverable near Manjimup unless noted.
select tests.set_discovery(pg_temp.uid(n)) from unnest(array['anu','biju','chitra','deepa','eldho','faisal','gopi','hari']) n;
select tests.place(pg_temp.uid('biju'),   -34.2392, 116.1459);          -- ~150 m
select tests.place(pg_temp.uid('chitra'), -34.2366, 116.1459);          -- ~450 m
select tests.place(pg_temp.uid('deepa'),  -34.2206, 116.1459);          -- ~2.2 km
select tests.place(pg_temp.uid('eldho'),  -34.2396, 116.1459, 10, 45);  -- stale (45 min)
select tests.place(pg_temp.uid('faisal'), -34.2400, 116.1459, 10, 0, true); -- mocked GPS
select tests.place(pg_temp.uid('gopi'),   -34.2401, 116.1459);          -- will be paused
select tests.place(pg_temp.uid('hari'),   -34.2402, 116.1459);          -- will block anu
update public.discovery_settings set paused_until = now() + interval '2 hours' where user_id = pg_temp.uid('gopi');
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('hari'), pg_temp.uid('anu'));

-- Reporting -----------------------------------------------------------------------
select tests.login_as(pg_temp.uid('lurker'));
select is(public.report_location(-34.2406, 116.1459, 10) ->> 'reason', 'NOT_DISCOVERABLE',
          'a member who is not discoverable cannot store a location');
select tests.logout();
select is((select count(*)::int from public.user_locations where user_id = pg_temp.uid('lurker')), 0, '... and nothing is stored');

select tests.login_as(pg_temp.uid('anu'));
select throws_ok($$select public.report_location(95, 116, 10)$$, '22023', 'LOCATION_INVALID', 'impossible coordinates rejected');
select is(public.report_location(-34.2406, 116.1459, 900) ->> 'reason', 'LOW_ACCURACY', 'very inaccurate fixes ignored');
select is(public.report_location(-34.2406, 116.1459, 10, false, now() - interval '20 minutes') ->> 'reason', 'STALE',
          'fixes that arrive late are ignored');
select is((public.report_location(-34.2406, 116.1459, 10) ->> 'stored')::boolean, true, 'a good fix is stored');
select tests.logout();
select is((select count(*)::int from public.user_locations where user_id = pg_temp.uid('anu')), 1, 'one current row, no history');

select tests.age_location(pg_temp.uid('anu'), 1);
select tests.login_as(pg_temp.uid('anu'));
select is(public.report_location(-31.9523, 115.8613, 10) ->> 'reason', 'IMPLAUSIBLE_MOVEMENT',
          'a jump to Perth one minute later is rejected');
select tests.logout();

-- Nearby list ------------------------------------------------------------------------
select tests.login_as(pg_temp.uid('anu'));
select set_eq($$select username from public.nearby_users(5000)$$, array['biju', 'chitra', 'deepa'],
              'nearby excludes stale, mocked, paused, blocking and non-discoverable members');
select set_eq($$select username from public.nearby_users(500)$$, array['biju', 'chitra'], 'radius limits results');
select is((select distance_label from public.nearby_users(500) where username = 'biju'), 'Under 250 m', 'distance is a coarse bucket');
select is((select count(*)::int from information_schema.routines r
            join information_schema.parameters p on p.specific_name = r.specific_name
           where r.routine_name = 'nearby_users' and p.parameter_mode = 'OUT'
             and p.parameter_name ~ '(lat|lng|lon|location|distance_m)'), 0,
          'nearby_users has no coordinate or exact-distance output');
select throws_ok($$select * from public.nearby_users(300)$$, '22023', 'RADIUS_INVALID', 'only the published radii are accepted');
select tests.logout();

update public.profile_details set interests = array['Cricket', 'Cooking'] where user_id = pg_temp.uid('chitra');
select tests.login_as(pg_temp.uid('anu'));
select set_eq($$select username from public.nearby_users(5000, null, null, array['cricket'])$$, array['chitra'],
              'interest filter matches case-insensitively');
select tests.logout();

update public.profile_visibility set interests = 'only_me' where user_id = pg_temp.uid('chitra');
select tests.login_as(pg_temp.uid('anu'));
select is((select count(*)::int from public.nearby_users(5000, null, null, array['cricket'])), 0,
          'hidden interests cannot be used to filter (no probing of private fields)');
select tests.logout();

-- Reciprocity and staleness of the viewer
select tests.login_as(pg_temp.uid('lurker'));
select throws_ok($$select * from public.nearby_users(5000)$$, 'PT403', 'DISCOVERY_OFF',
                 'you must be discoverable to see who is around you');
select tests.logout();
select tests.age_location(pg_temp.uid('anu'), 40);
select tests.login_as(pg_temp.uid('anu'));
select throws_ok($$select * from public.nearby_users(5000)$$, 'PT409', 'LOCATION_STALE', 'a stale own location must be refreshed first');
select tests.logout();

-- Browsing another town --------------------------------------------------------------------
create temp table before_browse as select * from public.user_locations where user_id = pg_temp.uid('anu');
grant select on before_browse to authenticated;
select tests.login_as(pg_temp.uid('lurker'));
select throws_ok($$select * from public.nearby_users(1000, -34.2406, 116.1459)$$, '22023', 'RADIUS_TOO_SMALL_FOR_AREA_SEARCH',
                 'area search needs at least 5 km');
select set_eq($$select username from public.nearby_users(5000, -34.2406, 116.1459)$$, array['biju', 'chitra', 'deepa', 'hari'],
              'anyone can browse a town; results respect freshness and the browser''s own blocks');
select tests.logout();
select is((select count(*)::int from public.user_locations where user_id = pg_temp.uid('lurker')), 0,
          'browsing a town does not store the browser''s location there');

select tests.login_as(pg_temp.uid('anu'));
select is((select count(*)::int from public.nearby_users(25000, -31.9523, 115.8613)), 0, 'nobody is around Perth in the fixtures');
select tests.logout();
select ok((select l.reported_at = b.reported_at and extensions.st_equals(l.location::extensions.geometry, b.location::extensions.geometry)
             from public.user_locations l, before_browse b where l.user_id = pg_temp.uid('anu')),
          'browsing Perth leaves the browser''s own stored location untouched');

-- Counts and map ---------------------------------------------------------------------------
select tests.login_as(pg_temp.uid('lurker'));
select is((public.area_summary(-34.2406, 116.1459, 10000) ->> 'count')::int, 6,
          'community count covers the last 24 h, excluding mocked and paused members');
select is(public.area_summary(-31.9523, 115.8613, 10000) -> 'count', 'null'::jsonb, 'counts under 3 are hidden');
select tests.logout();

update public.discovery_settings set map_visible = false where user_id = pg_temp.uid('deepa');
select tests.login_as(pg_temp.uid('lurker'));
select is((select sum(member_count)::int from public.map_cells(-34.2406, 116.1459, 5000)), 3,
          'map shows only map-visible members, in cells of at least 3');
select ok((select bool_and(abs((cell_lat / 0.01) - floor(cell_lat / 0.01) - 0.5) < 1e-6)
             from public.map_cells(-34.2406, 116.1459, 5000)),
          'map positions are grid-cell centres, not member positions');
select tests.logout();

update public.discovery_settings set map_visible = false where user_id = pg_temp.uid('chitra');
select tests.login_as(pg_temp.uid('lurker'));
select is((select count(*)::int from public.map_cells(-34.2406, 116.1459, 5000)), 0, 'a cell with only 2 people is not shown');
select tests.logout();

-- Turning discovery off removes you everywhere immediately
select tests.login_as(pg_temp.uid('biju'));
update public.discovery_settings set discoverable = false, map_visible = false, proximity_alerts = false where user_id = auth.uid();
select tests.logout();
select tests.login_as(pg_temp.uid('lurker'));
select ok(not exists (select 1 from public.nearby_users(5000, -34.2406, 116.1459) where username = 'biju'),
          'a member who turns discovery off vanishes from results at once');
select tests.logout();

-- Direct table access stays closed
select tests.login_as(pg_temp.uid('anu'));
select throws_ok($$select * from public.proximity_alerts$$, '42501', null, 'alert history is not readable by members');
select throws_ok($$select public.match_encounters(auth.uid())$$, '42501', null, 'matching cannot be triggered directly');
select tests.logout();

select * from finish();
rollback;
