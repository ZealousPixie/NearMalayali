-- Blocks, connections (minimal; request flow arrives in Stage C), roles,
-- audit log, rate limiting and the helper functions every policy relies on.

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- One row per connected pair, stored with user_a < user_b so a pair can only
-- exist once. Rows are created by server functions only.
create table public.connections (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint connections_ordered check (user_a < user_b)
);
create index connections_user_b_idx on public.connections (user_b);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- Fixed-window counters. Old windows are purged by a scheduled job.
create table public.rate_limits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (user_id, action, window_start)
);

alter table public.blocks enable row level security;
alter table public.connections enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limits enable row level security;

revoke all on public.blocks, public.connections, public.user_roles,
  public.audit_log, public.rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so policies can consult tables the caller cannot
-- read directly, e.g. whether *someone else* blocked them).
-- ---------------------------------------------------------------------------
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  )
$$;

create or replace function public.are_connected(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.connections
    where user_a = least(a, b) and user_b = greatest(a, b)
  )
$$;

create or replace function public.has_role(r public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = r
  )
$$;

-- A user other people may interact with: onboarded and active.
create or replace function public.is_active_member(u uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = u and account_status = 'active' and onboarding_completed_at is not null
  )
$$;

create or replace function public.can_view_field(owner uuid, viewer uuid, vis public.field_visibility)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when owner = viewer then true
    when vis = 'public' then true
    when vis = 'connections' then public.are_connected(owner, viewer)
    else false
  end
$$;

-- Raises RATE_LIMITED (HTTP 429 through PostgREST) when the caller exceeds
-- p_max calls of p_action within a fixed window of p_window_seconds.
create or replace function public.check_rate_limit(p_action text, p_max int, p_window_seconds int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_window timestamptz;
  v_hits int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, p_action, v_window, 1)
  on conflict (user_id, action, window_start)
  do update set hits = r.hits + 1
  returning hits into v_hits;
  if v_hits > p_max then
    raise exception 'RATE_LIMITED' using errcode = 'PT429';
  end if;
end;
$$;

create or replace function public.write_audit(p_action text, p_target_type text, p_target_id text, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb))
$$;

revoke execute on function public.is_blocked_between(uuid, uuid),
  public.are_connected(uuid, uuid), public.has_role(public.app_role),
  public.is_active_member(uuid), public.can_view_field(uuid, uuid, public.field_visibility),
  public.check_rate_limit(text, int, int), public.write_audit(text, text, text, jsonb)
  from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid),
  public.are_connected(uuid, uuid), public.has_role(public.app_role),
  public.is_active_member(uuid), public.can_view_field(uuid, uuid, public.field_visibility)
  to authenticated;
-- check_rate_limit / write_audit are only called from other definer functions.
revoke execute on function public.check_rate_limit(text, int, int),
  public.write_audit(text, text, text, jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
grant select, insert, delete on public.blocks to authenticated;
create policy "see blocks I made" on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
create policy "block someone" on public.blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy "unblock someone" on public.blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

grant select on public.connections to authenticated;
create policy "see my connections" on public.connections
  for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

grant select on public.user_roles to authenticated;
create policy "see my roles" on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.audit_log to authenticated;
create policy "admins read audit log" on public.audit_log
  for select to authenticated using (public.has_role('admin'));

-- Profiles: visible to signed-in users when active, onboarded and not
-- blocked in either direction. Owners always see their own row.
create policy "profiles visible to members" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (
      account_status = 'active'
      and onboarding_completed_at is not null
      and not public.is_blocked_between(id, (select auth.uid()))
    )
  );

-- Blocking someone also removes any connection between the pair.
create or replace function public.on_block_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.connections
  where user_a = least(new.blocker_id, new.blocked_id)
    and user_b = greatest(new.blocker_id, new.blocked_id);
  return new;
end;
$$;
revoke execute on function public.on_block_created() from public, anon, authenticated;

create trigger blocks_after_insert after insert on public.blocks
  for each row execute function public.on_block_created();
