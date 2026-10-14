-- Stage C: events (with RSVPs, invitations, attendee privacy and reminders)
-- and the community noticeboard.
--
-- Event addresses: hosts choose whether the exact address is shown to
-- everyone who can see the event, or only to people who said they're going.
-- Attendee names are shown to the host and to other people going; everyone
-- else sees a count. Attendees can also hide themselves from the list.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 120),
  description text not null default '' check (length(description) <= 5000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue_name text not null default '' check (length(venue_name) <= 120),
  address text not null default '' check (length(address) <= 300),
  address_visibility text not null default 'attendees' check (address_visibility in ('everyone', 'attendees')),
  region text not null default '' check (length(region) <= 80),
  online_url text check (online_url is null or online_url ~* '^https://'),
  visibility text not null default 'public' check (visibility in ('public', 'connections', 'group', 'invite_only')),
  capacity int check (capacity is null or capacity between 1 and 100000),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint events_time_order check (ends_at is null or ends_at > starts_at),
  constraint events_group_visibility check ((visibility = 'group') = (group_id is not null))
);
create index events_starts_idx on public.events (starts_at);

create table public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('going', 'interested', 'not_going', 'invited')),
  hide_from_list boolean not null default false,
  invited_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_rsvps_user_idx on public.event_rsvps (user_id, status);

alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
revoke all on public.events, public.event_rsvps from anon, authenticated;

create or replace function public.can_view_event(p_event uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event and p_viewer is not null
       and (e.host_id = p_viewer
            or (public.is_active_member(e.host_id)
                and not public.is_blocked_between(p_viewer, e.host_id)
                and (exists (select 1 from public.event_rsvps r where r.event_id = e.id and r.user_id = p_viewer)
                     or case e.visibility
                          when 'public' then true
                          when 'connections' then public.are_connected(p_viewer, e.host_id)
                          when 'group' then public.group_role(e.group_id, p_viewer) is not null
                          else false
                        end)))
  )
$$;
revoke execute on function public.can_view_event(uuid, uuid) from public, anon;
grant execute on function public.can_view_event(uuid, uuid) to authenticated;

-- No direct table reads: the address must go through event_details(), which
-- applies address_visibility. RLS still guards the tables as a second line.
create policy "viewable events" on public.events
  for select to authenticated using (public.can_view_event(id, (select auth.uid())));
create policy "own rsvps" on public.event_rsvps
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.validate_event_fields(
  p_title text, p_starts_at timestamptz, p_ends_at timestamptz, p_visibility text, p_group uuid, p_online_url text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_title is null or length(btrim(p_title)) not between 3 and 120 then
    raise exception 'EVENT_TITLE_INVALID' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 hour' or p_starts_at > now() + interval '2 years'
     or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise exception 'EVENT_TIME_INVALID' using errcode = '22023';
  end if;
  if p_visibility not in ('public', 'connections', 'group', 'invite_only')
     or ((p_visibility = 'group') <> (p_group is not null)) then
    raise exception 'VISIBILITY_INVALID' using errcode = '22023';
  end if;
  if p_group is not null and public.group_role(p_group, auth.uid()) is null then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  if p_online_url is not null and p_online_url !~* '^https://' then
    raise exception 'EVENT_URL_INVALID' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.validate_event_fields(text, timestamptz, timestamptz, text, uuid, text) from public, anon, authenticated;

create or replace function public.create_event(
  p_title text, p_description text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_venue_name text, p_address text, p_address_visibility text, p_region text,
  p_online_url text, p_visibility text, p_group uuid default null, p_capacity int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_id uuid;
begin
  perform public.validate_event_fields(p_title, p_starts_at, p_ends_at, p_visibility, p_group, nullif(btrim(p_online_url), ''));
  perform public.check_rate_limit('create_event', 5, 86400);
  insert into public.events (host_id, group_id, title, description, starts_at, ends_at, venue_name, address,
                             address_visibility, region, online_url, visibility, capacity)
  values (v_me, p_group, btrim(p_title), coalesce(btrim(p_description), ''), p_starts_at, p_ends_at,
          coalesce(btrim(p_venue_name), ''), coalesce(btrim(p_address), ''),
          coalesce(p_address_visibility, 'attendees'), coalesce(btrim(p_region), ''),
          nullif(btrim(p_online_url), ''), p_visibility, p_capacity)
  returning id into v_id;
  insert into public.event_rsvps (event_id, user_id, status) values (v_id, v_me, 'going');
  return v_id;
end;
$$;

create or replace function public.update_event(
  p_event uuid, p_title text, p_description text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_venue_name text, p_address text, p_address_visibility text, p_region text, p_online_url text, p_capacity int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  r record;
begin
  select * into e from public.events where id = p_event and host_id = auth.uid() and cancelled_at is null;
  if e.id is null then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  perform public.validate_event_fields(p_title, p_starts_at, p_ends_at, e.visibility, e.group_id, nullif(btrim(p_online_url), ''));
  update public.events
     set title = btrim(p_title), description = coalesce(btrim(p_description), ''), starts_at = p_starts_at,
         ends_at = p_ends_at, venue_name = coalesce(btrim(p_venue_name), ''), address = coalesce(btrim(p_address), ''),
         address_visibility = coalesce(p_address_visibility, 'attendees'), region = coalesce(btrim(p_region), ''),
         online_url = nullif(btrim(p_online_url), ''), capacity = p_capacity
   where id = p_event;
  if e.starts_at <> p_starts_at or e.address <> coalesce(btrim(p_address), '') then
    for r in select user_id from public.event_rsvps where event_id = p_event and status in ('going', 'interested') and user_id <> auth.uid() loop
      perform public.notify(r.user_id, 'event_reminder', btrim(p_title), 'The time or place has changed. Tap to see the details.',
        jsonb_build_object('screen', 'event', 'id', p_event), 'evchg:' || p_event || ':' || extract(epoch from now())::bigint);
    end loop;
  end if;
end;
$$;

create or replace function public.cancel_event(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  r record;
begin
  update public.events set cancelled_at = now()
   where id = p_event and host_id = auth.uid() and cancelled_at is null
  returning title into v_title;
  if v_title is null then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  for r in select user_id from public.event_rsvps where event_id = p_event and status in ('going', 'interested') and user_id <> auth.uid() loop
    perform public.notify(r.user_id, 'event_reminder', v_title, 'This event has been cancelled.',
      jsonb_build_object('screen', 'event', 'id', p_event), 'evcancel:' || p_event);
  end loop;
end;
$$;

create or replace function public.rsvp_event(p_event uuid, p_status text, p_hide_from_list boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  e public.events;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not public.can_view_event(p_event, v_me) then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  if e.cancelled_at is not null or coalesce(e.ends_at, e.starts_at + interval '6 hours') < now() then
    raise exception 'EVENT_CLOSED' using errcode = 'PT409';
  end if;
  if p_status not in ('going', 'interested', 'not_going') then
    raise exception 'RSVP_INVALID' using errcode = '22023';
  end if;
  if e.host_id = v_me and p_status <> 'going' then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  -- Lock the event row so two last-place RSVPs can't both get in.
  perform 1 from public.events where id = p_event for update;
  if p_status = 'going' and e.capacity is not null
     and (select count(*) from public.event_rsvps where event_id = p_event and status = 'going' and user_id <> v_me) >= e.capacity then
    raise exception 'EVENT_FULL' using errcode = 'PT409';
  end if;
  insert into public.event_rsvps (event_id, user_id, status, hide_from_list)
  values (p_event, v_me, p_status, coalesce(p_hide_from_list, false))
  on conflict (event_id, user_id) do update
    set status = excluded.status, hide_from_list = excluded.hide_from_list, updated_at = now();
end;
$$;

-- Hosts and people going can invite their connections.
create or replace function public.invite_to_event(p_event uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  e public.events;
begin
  select * into e from public.events where id = p_event and cancelled_at is null;
  if e.id is null or not (e.host_id = v_me or (e.visibility <> 'invite_only'
       and exists (select 1 from public.event_rsvps where event_id = p_event and user_id = v_me and status = 'going'))) then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  if not public.are_connected(v_me, p_user) or not public.can_interact(v_me, p_user) then
    raise exception 'USER_UNAVAILABLE' using errcode = 'PT404';
  end if;
  perform public.check_rate_limit('event_invite', 100, 86400);
  insert into public.event_rsvps (event_id, user_id, status, invited_by) values (p_event, p_user, 'invited', v_me)
  on conflict (event_id, user_id) do nothing;
  if found then
    perform public.notify(p_user, 'event_invite', e.title, public.display_name_of(v_me) || ' invited you',
      jsonb_build_object('screen', 'event', 'id', p_event), 'evinv:' || p_event);
  end if;
end;
$$;

create or replace function public.event_details(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.can_view_event(e.id, (select auth.uid())) then jsonb_build_object(
    'id', e.id, 'title', e.title, 'description', e.description, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
    'venue_name', e.venue_name, 'region', e.region, 'visibility', e.visibility, 'capacity', e.capacity,
    'cancelled_at', e.cancelled_at, 'group_id', e.group_id, 'group_name', g.name,
    'host_id', h.id, 'host_name', h.display_name, 'host_username', h.username, 'host_avatar', h.avatar_path,
    'is_host', e.host_id = (select auth.uid()),
    'my_status', me.status, 'my_hidden', me.hide_from_list,
    'address_visibility', e.address_visibility,
    'address', case when e.address_visibility = 'everyone' or e.host_id = (select auth.uid()) or me.status = 'going'
                    then nullif(e.address, '') end,
    'online_url', case when e.address_visibility = 'everyone' or e.host_id = (select auth.uid()) or me.status = 'going'
                       then e.online_url end,
    'has_online_link', e.online_url is not null,
    'going_count', (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'going'),
    'interested_count', (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'interested')
  ) end
    from public.events e
    join public.profiles h on h.id = e.host_id
    left join public.groups g on g.id = e.group_id
    left join public.event_rsvps me on me.event_id = e.id and me.user_id = (select auth.uid())
   where e.id = p_event
$$;

create or replace function public.event_attendees(p_event uuid)
returns table (user_id uuid, username text, display_name text, avatar_path text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_path, r.status
    from public.event_rsvps r
    join public.events e on e.id = r.event_id
    join public.profiles p on p.id = r.user_id
   where r.event_id = p_event
     and r.status in ('going', 'interested')
     and p.account_status = 'active'
     and not public.is_blocked_between((select auth.uid()), p.id)
     and (e.host_id = (select auth.uid())
          or exists (select 1 from public.event_rsvps mine
                      where mine.event_id = p_event and mine.user_id = (select auth.uid()) and mine.status = 'going'))
     and (not r.hide_from_list or e.host_id = (select auth.uid()) or r.user_id = (select auth.uid()))
   order by r.status, p.display_name
   limit 1000
$$;

-- p_scope: 'upcoming' (everything I can see), 'mine' (hosting or responded),
-- 'group' (p_group's events). Optional region text filter.
create or replace function public.list_events(
  p_scope text default 'upcoming', p_region text default null, p_group uuid default null,
  p_limit int default 30, p_offset int default 0
)
returns table (id uuid, title text, starts_at timestamptz, ends_at timestamptz, venue_name text, region text,
               host_name text, group_name text, going_count int, my_status text, cancelled boolean, is_host boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.starts_at, e.ends_at, e.venue_name, e.region, h.display_name, g.name,
         (select count(*)::int from public.event_rsvps r where r.event_id = e.id and r.status = 'going'),
         me.status, e.cancelled_at is not null, e.host_id = (select auth.uid())
    from public.events e
    join public.profiles h on h.id = e.host_id
    left join public.groups g on g.id = e.group_id
    left join public.event_rsvps me on me.event_id = e.id and me.user_id = (select auth.uid())
   where coalesce(e.ends_at, e.starts_at + interval '6 hours') >= now()
     and public.can_view_event(e.id, (select auth.uid()))
     and case p_scope
           when 'mine' then me.status in ('going', 'interested', 'invited')
           when 'group' then e.group_id = p_group
           else e.cancelled_at is null
         end
     and (p_region is null or length(btrim(p_region)) < 2
          or e.region ilike '%' || replace(replace(replace(btrim(p_region), '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by e.starts_at
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

-- Reminder about 24 hours before, once per event per person. Run hourly.
create or replace function public.send_event_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select e.id, e.title, e.starts_at, rs.user_id
      from public.events e
      join public.event_rsvps rs on rs.event_id = e.id and rs.status = 'going'
     where e.cancelled_at is null
       and e.starts_at between now() + interval '23 hours' and now() + interval '25 hours'
       and public.is_active_member(rs.user_id)
  loop
    perform public.notify(r.user_id, 'event_reminder', r.title, 'Starts tomorrow. Tap for details.',
      jsonb_build_object('screen', 'event', 'id', r.id), 'evrem:' || r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.send_event_reminders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('event-reminders', '5 * * * *', 'select public.send_event_reminders()');
  else
    raise notice 'pg_cron not available; schedule public.send_event_reminders() hourly';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Noticeboard: short community notices that expire. No payments of any kind
-- happen in the app; "for sale" notices are contact-only.
-- ---------------------------------------------------------------------------
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in (
    'accommodation', 'jobs', 'for_sale', 'rides', 'services', 'lost_found', 'announcements', 'help_wanted'
  )),
  title text not null check (length(btrim(title)) between 5 and 120),
  body text not null check (length(btrim(body)) between 10 and 3000),
  region text not null check (length(btrim(region)) between 2 and 80),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  deleted_at timestamptz,
  constraint notices_expiry check (expires_at > created_at and expires_at <= created_at + interval '60 days')
);
create index notices_region_idx on public.notices (lower(region), created_at desc);

alter table public.notices enable row level security;
revoke all on public.notices from anon, authenticated;
grant select on public.notices to authenticated;
create policy "live notices" on public.notices
  for select to authenticated using (
    author_id = (select auth.uid())
    or (deleted_at is null and expires_at > now()
        and public.is_active_member(author_id)
        and not public.is_blocked_between((select auth.uid()), author_id)));

create or replace function public.create_notice(p_category text, p_title text, p_body text, p_region text, p_days int default 30)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_id uuid;
begin
  -- New accounts wait a few days before posting notices (spam protection).
  if (select created_at from public.profiles where id = v_me) > now() - interval '3 days' then
    raise exception 'ACCOUNT_TOO_NEW' using errcode = 'PT403';
  end if;
  if p_days is null or p_days not between 1 and 60 then
    raise exception 'NOTICE_EXPIRY_INVALID' using errcode = '22023';
  end if;
  if p_category is null or p_title is null or p_body is null or p_region is null
     or length(btrim(p_title)) not between 5 and 120 or length(btrim(p_body)) not between 10 and 3000
     or length(btrim(p_region)) not between 2 and 80
     or p_category not in ('accommodation', 'jobs', 'for_sale', 'rides', 'services', 'lost_found', 'announcements', 'help_wanted') then
    raise exception 'NOTICE_INVALID' using errcode = '22023';
  end if;
  perform public.check_rate_limit('create_notice', 3, 86400);
  insert into public.notices (author_id, category, title, body, region, expires_at)
  values (v_me, p_category, btrim(p_title), btrim(p_body), btrim(p_region), now() + make_interval(days => p_days))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_notice(p_notice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notices set deleted_at = now() where id = p_notice and author_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'NOTICE_NOT_FOUND' using errcode = 'PT404';
  end if;
end;
$$;

create or replace function public.list_notices(p_category text default null, p_region text default null, p_query text default null,
                                               p_limit int default 30, p_offset int default 0)
returns table (id uuid, category text, title text, body text, region text, created_at timestamptz, expires_at timestamptz,
               author_id uuid, author_name text, author_username text, is_mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.category, n.title, n.body, n.region, n.created_at, n.expires_at,
         a.id, a.display_name, a.username, n.author_id = (select auth.uid())
    from public.notices n
    join public.profiles a on a.id = n.author_id
   where n.deleted_at is null and n.expires_at > now()
     and a.account_status = 'active'
     and not public.is_blocked_between((select auth.uid()), n.author_id)
     and (p_category is null or n.category = p_category)
     and (p_region is null or length(btrim(p_region)) < 2
          or n.region ilike '%' || replace(replace(replace(btrim(p_region), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     and (p_query is null or length(btrim(p_query)) < 2
          or n.title ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or n.body ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by n.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

revoke execute on function
  public.create_event(text, text, timestamptz, timestamptz, text, text, text, text, text, text, uuid, int),
  public.update_event(uuid, text, text, timestamptz, timestamptz, text, text, text, text, text, int),
  public.cancel_event(uuid), public.rsvp_event(uuid, text, boolean), public.invite_to_event(uuid, uuid),
  public.event_details(uuid), public.event_attendees(uuid), public.list_events(text, text, uuid, int, int),
  public.create_notice(text, text, text, text, int), public.delete_notice(uuid),
  public.list_notices(text, text, text, int, int)
  from public, anon;
grant execute on function
  public.create_event(text, text, timestamptz, timestamptz, text, text, text, text, text, text, uuid, int),
  public.update_event(uuid, text, text, timestamptz, timestamptz, text, text, text, text, text, int),
  public.cancel_event(uuid), public.rsvp_event(uuid, text, boolean), public.invite_to_event(uuid, uuid),
  public.event_details(uuid), public.event_attendees(uuid), public.list_events(text, text, uuid, int, int),
  public.create_notice(text, text, text, text, int), public.delete_notice(uuid),
  public.list_notices(text, text, text, int, int)
  to authenticated;
