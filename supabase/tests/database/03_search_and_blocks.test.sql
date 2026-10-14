-- Stage A: people search and the blocked-users list.
begin;
set search_path to public, extensions;
select plan(7);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated;
insert into u values
  ('anu', tests.create_user('anu@example.com')),
  ('anand', tests.create_user('anand@example.com')),
  ('anjali', tests.create_user('anjali@example.com')),
  ('arun', tests.create_user('arun@example.com')),
  ('new', tests.create_user('new@example.com'));
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;
select tests.onboard(pg_temp.uid('anu'), 'anu');
select tests.onboard(pg_temp.uid('anand'), 'anand');
select tests.onboard(pg_temp.uid('anjali'), 'anjali');
select tests.onboard(pg_temp.uid('arun'), 'arun');
update public.profile_visibility set searchable = false where user_id = pg_temp.uid('anjali');
update public.profile_visibility set home_region = 'connections' where user_id = pg_temp.uid('anand');
update public.profile_details set home_region = 'Manjimup' where user_id = pg_temp.uid('anand');
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('arun'), pg_temp.uid('anu'));

select tests.login_as(pg_temp.uid('anu'));
select set_eq($$select username from public.search_people('an')$$, array['anand'],
              'search excludes self, unsearchable and not-yet-onboarded members');
select is((select home_region from public.search_people('anand')), null, 'non-public region is not revealed in search');
select is((select count(*)::int from public.search_people('ar')), 0, 'members who blocked me are not searchable');
select is((select count(*)::int from public.search_people('%')), 0, 'wildcards are treated literally');
select is((select count(*)::int from public.search_people('a')), 0, 'one-character queries return nothing');
select tests.logout();

select tests.login_as(pg_temp.uid('arun'));
select is((select username from public.list_blocked_users()), 'anu', 'blocker sees whom they blocked');
select tests.logout();
select tests.login_as(pg_temp.uid('anu'));
select is((select count(*)::int from public.list_blocked_users()), 0, 'blocked member sees nothing');
select tests.logout();

select * from finish();
rollback;
