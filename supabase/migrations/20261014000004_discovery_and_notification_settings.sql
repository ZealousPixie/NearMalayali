-- Discovery preferences, the private current-location table and notification
-- preferences. Everything about discovery is OFF for new accounts.

create table public.discovery_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Master switch: may other people find me through nearby discovery?
  discoverable boolean not null default false,
  -- Sub-options, only possible while discoverable.
  map_visible boolean not null default false,
  proximity_alerts boolean not null default false,
  -- Default radius for my own searches.
  discovery_radius_m int not null default 10000,
  -- How close another member must be before I get an alert.
  alert_radius_m int not null default 500,
  -- Minimum hours before the same person can trigger another alert for me.
  alert_cooldown_hours int not null default 12,
  -- Temporary invisibility: hidden from everything until this time.
  paused_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint discovery_suboptions_need_discoverable
    check (discoverable or (not map_visible and not proximity_alerts)),
  constraint discovery_radius_allowed
    check (discovery_radius_m in (100, 250, 500, 1000, 5000, 10000, 25000, 50000)),
  constraint alert_radius_allowed
    check (alert_radius_m in (100, 250, 500, 1000, 2000, 5000)),
  constraint alert_cooldown_range
    check (alert_cooldown_hours between 1 and 168)
);

create trigger discovery_settings_updated_at before update on public.discovery_settings
  for each row execute function public.set_updated_at();

-- Exactly one current location per user. NO history is kept.
-- No client role can read or write this table; only server functions can.
create table public.user_locations (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  location extensions.geography(point, 4326) not null,
  accuracy_m real not null check (accuracy_m > 0),
  is_mocked boolean not null default false,
  reported_at timestamptz not null default now()
);

create index user_locations_location_gix on public.user_locations using gist (location);
create index user_locations_reported_idx on public.user_locations (reported_at);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  push_enabled boolean not null default true,
  proximity boolean not null default true,
  connection_requests boolean not null default true,
  connection_accepted boolean not null default true,
  messages boolean not null default true,
  group_invites boolean not null default true,
  follows boolean not null default true,
  reactions_comments boolean not null default true,
  event_invites boolean not null default true,
  event_reminders boolean not null default true,
  group_activity boolean not null default true,
  -- Security notices are always recorded in-app; this only controls push.
  security boolean not null default true,
  -- Lock-screen previews off by default for privacy.
  show_previews boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.discovery_settings enable row level security;
alter table public.user_locations enable row level security;
alter table public.notification_preferences enable row level security;

revoke all on public.discovery_settings, public.user_locations,
  public.notification_preferences from anon, authenticated;

grant select on public.discovery_settings to authenticated;
grant update (discoverable, map_visible, proximity_alerts, discovery_radius_m,
  alert_radius_m, alert_cooldown_hours, paused_until)
  on public.discovery_settings to authenticated;
create policy "own discovery settings readable" on public.discovery_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own discovery settings editable" on public.discovery_settings
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select on public.notification_preferences to authenticated;
grant update (push_enabled, proximity, connection_requests, connection_accepted, messages,
  group_invites, follows, reactions_comments, event_invites, event_reminders,
  group_activity, security, show_previews)
  on public.notification_preferences to authenticated;
create policy "own notification prefs readable" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own notification prefs editable" on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- user_locations: intentionally no policies and no grants.

-- ---------------------------------------------------------------------------
-- Enforcement triggers
-- ---------------------------------------------------------------------------

-- Pausing is limited to 30 days ahead. Turning discovery off, or pausing,
-- deletes the stored location immediately.
create or replace function public.on_discovery_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.paused_until is not null and new.paused_until > now() + interval '30 days' then
    raise exception 'PAUSE_TOO_LONG' using errcode = '22023';
  end if;
  if not new.discoverable
     or (new.paused_until is not null and new.paused_until > now()) then
    delete from public.user_locations where user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.on_discovery_settings_change() from public, anon, authenticated;

create trigger discovery_settings_enforce before update on public.discovery_settings
  for each row execute function public.on_discovery_settings_change();

-- An account that stops being active disappears from discovery at once.
create or replace function public.on_profile_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_status <> 'active' and old.account_status = 'active' then
    update public.discovery_settings
      set discoverable = false, map_visible = false, proximity_alerts = false
      where user_id = new.id;
    delete from public.user_locations where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.on_profile_status_change() from public, anon, authenticated;

create trigger profiles_status_change after update of account_status on public.profiles
  for each row execute function public.on_profile_status_change();

-- Locations older than this are never used and are deleted by the cleanup job.
create or replace function public.purge_stale_locations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.user_locations where reported_at < now() - interval '24 hours';
  get diagnostics v_count = row_count;
  delete from public.rate_limits where window_start < now() - interval '2 days';
  return v_count;
end;
$$;
revoke execute on function public.purge_stale_locations() from public, anon, authenticated;
