-- Stage B: location reporting, nearby discovery, community counts, map
-- cells and proximity encounters.
--
-- Privacy rules implemented here (all enforced server-side):
--   * Only the caller's own location can be written, at most every few
--     seconds, and only while they are discoverable, active and not paused.
--   * Nothing returns coordinates of other people. Distances are buckets,
--     map positions are grid-cell centres for cells with >= 3 people, and
--     results are not ordered by exact distance within a bucket.
--   * Browsing around a town never reads or writes the caller's location.
--   * Seeing who is around YOU requires that you are discoverable yourself
--     (reciprocity: no invisible lurking) and have a fresh location.
--   * Blocked pairs, paused, deactivated, suspended and mocked locations are
--     excluded everywhere.

-- Tunables in one place so tests and docs can refer to them.
create or replace function public.discovery_config()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'list_fresh_minutes', 30,     -- others must have reported within this to be listed nearby
    'alert_fresh_minutes', 15,    -- ... and within this to trigger an alert
    'map_fresh_hours', 24,        -- map / community counts use the last 24 h
    'max_report_accuracy_m', 500, -- reports less accurate than this are ignored
    'max_alert_accuracy_m', 100,  -- alerts need at least this accuracy on both sides
    'max_report_age_minutes', 10, -- a fix older than this when it arrives is stale
    'max_speed_mps', 350,         -- faster than an airliner = implausible jump
    'min_k', 3,                   -- minimum people per map cell / count before showing
    'min_remote_radius_m', 5000,  -- smallest radius when browsing another town
    'max_alerts_per_day', 10      -- per recipient, to avoid floods in busy places
  )
$$;

create or replace function public.make_point(p_lat double precision, p_lng double precision)
returns extensions.geography
language sql
immutable
set search_path = ''
as $$
  select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
$$;

-- Distance shown to people. Coarse on purpose.
create or replace function public.distance_bucket(p_metres double precision)
returns table (label text, sort_order int)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    (case
      when p_metres < 250 then 'Under 250 m'
      when p_metres < 500 then 'Under 500 m'
      when p_metres < 1000 then 'Under 1 km'
      when p_metres < 2000 then '1–2 km'
      when p_metres < 5000 then '2–5 km'
      when p_metres < 10000 then '5–10 km'
      when p_metres < 25000 then '10–25 km'
      else '25–50 km'
    end,
    case
      when p_metres < 250 then 1
      when p_metres < 500 then 2
      when p_metres < 1000 then 3
      when p_metres < 2000 then 4
      when p_metres < 5000 then 5
      when p_metres < 10000 then 6
      when p_metres < 25000 then 7
      else 8
    end)
  ) as t(label, sort_order)
$$;

-- ---------------------------------------------------------------------------
-- Notifications (used by alerts here; other kinds arrive in Stage C)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'proximity', 'connection_request', 'connection_accepted', 'message', 'follow',
    'reaction', 'comment', 'group_invite', 'group_activity', 'event_invite',
    'event_reminder', 'security'
  )),
  title text not null check (length(title) <= 120),
  body text not null check (length(body) <= 300),
  -- Navigation hints for the app. Never coordinates.
  data jsonb not null default '{}'::jsonb,
  -- Prevents duplicates when the same event is processed twice.
  dedupe_key text not null,
  read_at timestamptz,
  push_status text not null default 'pending'
    check (push_status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  push_attempts int not null default 0,
  push_error text,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_push_pending_idx on public.notifications (created_at) where push_status = 'pending';

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- One row per alert sent, used for cooldowns and the daily cap.
-- Deleted after 30 days by the cleanup job. Holds no location.
create table public.proximity_alerts (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  other_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index proximity_alerts_pair_idx on public.proximity_alerts (recipient_id, other_id, created_at desc);
create index proximity_alerts_recipient_idx on public.proximity_alerts (recipient_id, created_at desc);

alter table public.proximity_alerts enable row level security;
revoke all on public.proximity_alerts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Eligibility helper: may this user take part in discovery right now?
-- ---------------------------------------------------------------------------
create or replace function public.discovery_eligible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.discovery_settings s on s.user_id = p.id
    where p.id = p_user
      and p.account_status = 'active'
      and p.onboarding_completed_at is not null
      and s.discoverable
      and (s.paused_until is null or s.paused_until <= now())
  )
$$;

-- ---------------------------------------------------------------------------
-- report_location: the ONLY way a location enters the system.
-- ---------------------------------------------------------------------------
create or replace function public.report_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_is_mocked boolean default false,
  p_recorded_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.discovery_config();
  v_uid uuid := auth.uid();
  v_point extensions.geography;
  v_at timestamptz := least(coalesce(p_recorded_at, now()), now());
  v_prev public.user_locations;
  v_alerts int := 0;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  perform public.check_rate_limit('report_location', 40, 600);

  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m <= 0 then
    raise exception 'LOCATION_INVALID' using errcode = '22023';
  end if;

  if not public.discovery_eligible(v_uid) then
    delete from public.user_locations where user_id = v_uid;
    return jsonb_build_object('stored', false, 'reason', 'NOT_DISCOVERABLE');
  end if;

  if p_accuracy_m > (cfg ->> 'max_report_accuracy_m')::float then
    return jsonb_build_object('stored', false, 'reason', 'LOW_ACCURACY');
  end if;

  if coalesce(p_recorded_at, now()) < now() - make_interval(mins => (cfg ->> 'max_report_age_minutes')::int)
     or p_recorded_at > now() + interval '2 minutes' then
    return jsonb_build_object('stored', false, 'reason', 'STALE');
  end if;

  v_point := public.make_point(p_lat, p_lng);

  select * into v_prev from public.user_locations where user_id = v_uid;
  if found then
    if v_at <= v_prev.reported_at then
      -- Out-of-order delivery (e.g. queued while offline): keep the newer one.
      return jsonb_build_object('stored', false, 'reason', 'OUT_OF_ORDER');
    end if;
    if extensions.st_distance(v_prev.location, v_point)
         / greatest(extract(epoch from (v_at - v_prev.reported_at)), 1)
       > (cfg ->> 'max_speed_mps')::float then
      return jsonb_build_object('stored', false, 'reason', 'IMPLAUSIBLE_MOVEMENT');
    end if;
  end if;

  insert into public.user_locations (user_id, location, accuracy_m, is_mocked, reported_at)
  values (v_uid, v_point, p_accuracy_m, coalesce(p_is_mocked, false), v_at)
  on conflict (user_id) do update
    set location = excluded.location,
        accuracy_m = excluded.accuracy_m,
        is_mocked = excluded.is_mocked,
        reported_at = excluded.reported_at;

  if not coalesce(p_is_mocked, false) then
    v_alerts := public.match_encounters(v_uid);
  end if;

  return jsonb_build_object('stored', true, 'alerts', v_alerts);
end;
$$;

-- Finds eligible members close to p_user and creates alerts for each side
-- that wants them, honouring cooldowns, the daily cap, blocks and prefs.
-- Returns the number of alerts created for p_user.
create or replace function public.match_encounters(p_user uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.discovery_config();
  me record;
  cand record;
  v_created int := 0;
begin
  select l.location, l.accuracy_m, l.reported_at, s.proximity_alerts, s.alert_radius_m
    into me
    from public.user_locations l
    join public.discovery_settings s on s.user_id = l.user_id
   where l.user_id = p_user;
  if not found or not me.proximity_alerts then
    return 0;
  end if;

  for cand in
    select l.user_id, s.alert_radius_m
      from public.user_locations l
      join public.discovery_settings s on s.user_id = l.user_id
      join public.profiles p on p.id = l.user_id
     where l.user_id <> p_user
       and s.discoverable and s.proximity_alerts
       and (s.paused_until is null or s.paused_until <= now())
       and p.account_status = 'active' and p.onboarding_completed_at is not null
       and not l.is_mocked
       and l.reported_at > now() - make_interval(mins => (cfg ->> 'alert_fresh_minutes')::int)
       -- Cheap index-backed pre-filter at the largest possible alert radius.
       and extensions.st_dwithin(l.location, me.location, 5000)
       -- Each side's own threshold: the smaller of the two radii applies.
       and extensions.st_dwithin(l.location, me.location, least(s.alert_radius_m, me.alert_radius_m))
       -- False-positive control: both fixes must be reasonably accurate
       -- relative to the threshold (at most half of it, capped).
       and l.accuracy_m <= least((cfg ->> 'max_alert_accuracy_m')::float,
                                 greatest(least(s.alert_radius_m, me.alert_radius_m) * 0.5, 25))
       and me.accuracy_m <= least((cfg ->> 'max_alert_accuracy_m')::float,
                                  greatest(least(s.alert_radius_m, me.alert_radius_m) * 0.5, 25))
       and not public.is_blocked_between(p_user, l.user_id)
     order by extensions.st_distance(l.location, me.location)
     limit 20
  loop
    -- Serialise work on this pair so two phones reporting at the same moment
    -- cannot both create an alert.
    perform pg_advisory_xact_lock(hashtextextended(least(p_user, cand.user_id)::text || greatest(p_user, cand.user_id)::text, 0));

    if public.create_proximity_alert(p_user, cand.user_id) then
      v_created := v_created + 1;
    end if;
    perform public.create_proximity_alert(cand.user_id, p_user);
  end loop;

  return v_created;
end;
$$;

-- Creates one alert for p_recipient about p_other unless suppressed.
create or replace function public.create_proximity_alert(p_recipient uuid, p_other uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.discovery_config();
  v_cooldown int;
  v_alert_id bigint;
begin
  select alert_cooldown_hours into v_cooldown
    from public.discovery_settings where user_id = p_recipient and proximity_alerts;
  if not found then
    return false;
  end if;

  if exists (
    select 1 from public.proximity_alerts
     where recipient_id = p_recipient and other_id = p_other
       and created_at > now() - make_interval(hours => v_cooldown)
  ) then
    return false;
  end if;

  if (select count(*) from public.proximity_alerts
       where recipient_id = p_recipient and created_at > now() - interval '24 hours')
     >= (cfg ->> 'max_alerts_per_day')::int then
    return false;
  end if;

  insert into public.proximity_alerts (recipient_id, other_id) values (p_recipient, p_other)
    returning id into v_alert_id;

  -- Deliberately says nothing about who or where.
  insert into public.notifications (user_id, kind, title, body, data, dedupe_key)
  values (p_recipient, 'proximity', 'A fellow Malayali is nearby',
          'Would you like to discover your community?',
          jsonb_build_object('screen', 'discover'),
          'proximity:' || v_alert_id)
  on conflict (user_id, dedupe_key) do nothing;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- nearby_users: list of people around me, or around a chosen place.
-- ---------------------------------------------------------------------------
create or replace function public.nearby_users(
  p_radius_m int,
  p_center_lat double precision default null,
  p_center_lng double precision default null,
  p_interests text[] default null,
  p_preferences text[] default null,
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_path text,
  is_verified boolean,
  is_connected boolean,
  distance_label text,
  distance_order int,
  home_region text,
  interests text[],
  connection_preferences text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.discovery_config();
  v_uid uuid := auth.uid();
  v_center extensions.geography;
  v_remote boolean := p_center_lat is not null and p_center_lng is not null;
  v_interests text[];
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if p_radius_m is null or p_radius_m not in (100, 250, 500, 1000, 5000, 10000, 25000, 50000) then
    raise exception 'RADIUS_INVALID' using errcode = '22023';
  end if;
  if not public.is_active_member(v_uid) then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;

  if v_remote then
    if p_center_lat not between -90 and 90 or p_center_lng not between -180 and 180 then
      raise exception 'LOCATION_INVALID' using errcode = '22023';
    end if;
    if p_radius_m < (cfg ->> 'min_remote_radius_m')::int then
      raise exception 'RADIUS_TOO_SMALL_FOR_AREA_SEARCH' using errcode = '22023';
    end if;
    v_center := public.make_point(p_center_lat, p_center_lng);
  else
    -- Reciprocity: you must be discoverable to see who is around you.
    if not public.discovery_eligible(v_uid) then
      raise exception 'DISCOVERY_OFF' using errcode = 'PT403';
    end if;
    select location into v_center from public.user_locations
     where user_id = v_uid
       and reported_at > now() - make_interval(mins => (cfg ->> 'list_fresh_minutes')::int);
    if v_center is null then
      raise exception 'LOCATION_STALE' using errcode = 'PT409';
    end if;
  end if;

  -- Rate limit after cheap validation, so typos don't burn the budget.
  perform public.check_rate_limit('nearby_users', 30, 600);

  v_interests := (select array_agg(lower(btrim(x))) from unnest(p_interests) as x where btrim(x) <> '');

  return query
  select p.id, p.username, p.display_name, p.avatar_path, p.is_verified,
         public.are_connected(v_uid, p.id),
         b.label, b.sort_order,
         case when public.can_view_field(p.id, v_uid, vis.home_region) then d.home_region end,
         case when public.can_view_field(p.id, v_uid, vis.interests) then d.interests end,
         case when public.can_view_field(p.id, v_uid, vis.connection_preferences) then d.connection_preferences end
    from public.user_locations l
    join public.discovery_settings s on s.user_id = l.user_id
    join public.profiles p on p.id = l.user_id
    join public.profile_details d on d.user_id = p.id
    join public.profile_visibility vis on vis.user_id = p.id
    cross join lateral public.distance_bucket(extensions.st_distance(l.location, v_center)) b
   where l.user_id <> v_uid
     and s.discoverable
     and (s.paused_until is null or s.paused_until <= now())
     and p.account_status = 'active' and p.onboarding_completed_at is not null
     and not l.is_mocked
     and l.reported_at > now() - make_interval(mins => (cfg ->> 'list_fresh_minutes')::int)
     and extensions.st_dwithin(l.location, v_center, p_radius_m)
     and not public.is_blocked_between(v_uid, p.id)
     and (v_interests is null or (
           public.can_view_field(p.id, v_uid, vis.interests)
           and exists (select 1 from unnest(d.interests) i where lower(i) = any (v_interests))))
     and (p_preferences is null or cardinality(p_preferences) = 0 or (
           public.can_view_field(p.id, v_uid, vis.connection_preferences)
           and d.connection_preferences && p_preferences))
   -- Within a bucket, order by a per-viewer hash, not by distance.
   order by b.sort_order, md5(p.id::text || v_uid::text)
   limit least(greatest(coalesce(p_limit, 30), 1), 50)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- How many discoverable members were in an area in the last day.
-- Exact counts below min_k are hidden. Never uses the caller's location.
create or replace function public.area_summary(
  p_center_lat double precision,
  p_center_lng double precision,
  p_radius_m int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.discovery_config();
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if p_center_lat is null or p_center_lng is null
     or p_center_lat not between -90 and 90 or p_center_lng not between -180 and 180 then
    raise exception 'LOCATION_INVALID' using errcode = '22023';
  end if;
  if p_radius_m is null or p_radius_m < 1000 or p_radius_m > 50000 then
    raise exception 'RADIUS_INVALID' using errcode = '22023';
  end if;
  perform public.check_rate_limit('area_summary', 60, 600);

  select count(*) into v_count
    from public.user_locations l
    join public.discovery_settings s on s.user_id = l.user_id
    join public.profiles p on p.id = l.user_id
   where s.discoverable
     and (s.paused_until is null or s.paused_until <= now())
     and p.account_status = 'active' and p.onboarding_completed_at is not null
     and not l.is_mocked
     and l.reported_at > now() - make_interval(hours => (cfg ->> 'map_fresh_hours')::int)
     and extensions.st_dwithin(l.location, public.make_point(p_center_lat, p_center_lng), p_radius_m)
     and l.user_id <> v_uid
     and not public.is_blocked_between(v_uid, l.user_id);

  if v_count < (cfg ->> 'min_k')::int then
    return jsonb_build_object('count', null, 'fewer_than', (cfg ->> 'min_k')::int);
  end if;
  return jsonb_build_object('count', v_count);
end;
$$;

-- Map clusters: grid cells holding at least min_k map-visible members.
-- Returns the cell CENTRE, not the members' average position.
create or replace function public.map_cells(
  p_center_lat double precision,
  p_center_lng double precision,
  p_radius_m int
)
returns table (cell_lat double precision, cell_lng double precision, member_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.discovery_config();
  v_uid uuid := auth.uid();
  v_size double precision;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if p_center_lat is null or p_center_lng is null
     or p_center_lat not between -90 and 90 or p_center_lng not between -180 and 180 then
    raise exception 'LOCATION_INVALID' using errcode = '22023';
  end if;
  if p_radius_m is null or p_radius_m < 1000 or p_radius_m > 50000 then
    raise exception 'RADIUS_INVALID' using errcode = '22023';
  end if;
  perform public.check_rate_limit('map_cells', 60, 600);

  -- Cells of roughly 1 km, 5 km or 10 km depending on zoom.
  v_size := case when p_radius_m <= 5000 then 0.01 when p_radius_m <= 25000 then 0.05 else 0.1 end;

  return query
  select (floor(extensions.st_y(l.location::extensions.geometry) / v_size) + 0.5) * v_size,
         (floor(extensions.st_x(l.location::extensions.geometry) / v_size) + 0.5) * v_size,
         count(*)::int
    from public.user_locations l
    join public.discovery_settings s on s.user_id = l.user_id
    join public.profiles p on p.id = l.user_id
   where s.discoverable and s.map_visible
     and (s.paused_until is null or s.paused_until <= now())
     and p.account_status = 'active' and p.onboarding_completed_at is not null
     and not l.is_mocked
     and l.reported_at > now() - make_interval(hours => (cfg ->> 'map_fresh_hours')::int)
     and extensions.st_dwithin(l.location, public.make_point(p_center_lat, p_center_lng), p_radius_m)
     and not public.is_blocked_between(v_uid, l.user_id)
   group by 1, 2
  having count(*) >= (cfg ->> 'min_k')::int;
end;
$$;

-- Lets the app show whether its last report is fresh, without coordinates.
create or replace function public.my_location_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('has_location', true, 'reported_at', reported_at, 'accuracy_m', round(accuracy_m))
       from public.user_locations where user_id = (select auth.uid())),
    jsonb_build_object('has_location', false)
  )
$$;

-- Stop sharing right now (e.g. from the app's "Stop sharing" button).
create or replace function public.clear_my_location()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.user_locations where user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Notifications API for the app
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
   where user_id = (select auth.uid()) and id = any (p_ids) and read_at is null
$$;

create or replace function public.mark_all_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
   where user_id = (select auth.uid()) and read_at is null
$$;

-- Extend the cleanup job: alert history older than 30 days, read
-- notifications older than 90 days.
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
  delete from public.proximity_alerts where created_at < now() - interval '30 days';
  delete from public.notifications where read_at is not null and created_at < now() - interval '90 days';
  return v_count;
end;
$$;

revoke execute on function
  public.make_point(double precision, double precision),
  public.distance_bucket(double precision),
  public.discovery_eligible(uuid),
  public.report_location(double precision, double precision, double precision, boolean, timestamptz),
  public.match_encounters(uuid),
  public.create_proximity_alert(uuid, uuid),
  public.nearby_users(int, double precision, double precision, text[], text[], int, int),
  public.area_summary(double precision, double precision, int),
  public.map_cells(double precision, double precision, int),
  public.my_location_status(),
  public.clear_my_location(),
  public.mark_notifications_read(bigint[]),
  public.mark_all_notifications_read(),
  public.purge_stale_locations()
  from public, anon, authenticated;

grant execute on function
  public.report_location(double precision, double precision, double precision, boolean, timestamptz),
  public.nearby_users(int, double precision, double precision, text[], text[], int, int),
  public.area_summary(double precision, double precision, int),
  public.map_cells(double precision, double precision, int),
  public.my_location_status(),
  public.clear_my_location(),
  public.mark_notifications_read(bigint[]),
  public.mark_all_notifications_read()
  to authenticated;
