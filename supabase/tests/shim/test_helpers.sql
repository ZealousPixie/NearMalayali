-- Helpers for database tests: create users and act as them.
-- Applied by scripts/db-test.sh after the migrations. Never ship to production.

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.create_user(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into auth.users (email, email_confirmed_at) values (p_email, now()) returning id into v_id;
  return v_id;
end;
$$;

-- Marks a user as onboarded without going through the RPC (fast setup).
create or replace function tests.onboard(p_user uuid, p_username text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set username = p_username, display_name = initcap(p_username), onboarding_completed_at = now()
   where id = p_user;
  update public.account_private set date_of_birth = date '1990-01-01' where user_id = p_user;
$$;

create or replace function tests.connect(a uuid, b uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.connections (user_a, user_b) values (least(a, b), greatest(a, b))
$$;

-- Act as a signed-in user for the rest of the transaction.
create or replace function tests.login_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.login_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end;
$$;

-- Back to the superuser test runner.
create or replace function tests.logout()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
