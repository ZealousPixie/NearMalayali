-- Stage C: connection requests, follows, relationship summaries and
-- suggestions. Connections are mutual and need consent from both people;
-- follows are one-way. A proximity encounter never creates either.

create table public.connection_requests (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  message text check (message is null or length(message) <= 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint connection_requests_not_self check (sender_id <> recipient_id)
);
-- At most one pending request per pair, in either direction.
create unique index connection_requests_one_pending
  on public.connection_requests (least(sender_id, recipient_id), greatest(sender_id, recipient_id))
  where status = 'pending';
create index connection_requests_recipient_idx on public.connection_requests (recipient_id, status, created_at desc);
create index connection_requests_sender_idx on public.connection_requests (sender_id, status, created_at desc);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id, created_at desc);

alter table public.connection_requests enable row level security;
alter table public.follows enable row level security;
revoke all on public.connection_requests, public.follows from anon, authenticated;

grant select on public.connection_requests to authenticated;
create policy "see my requests" on public.connection_requests
  for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));

grant select on public.follows to authenticated;
create policy "see follows involving me" on public.follows
  for select to authenticated
  using ((select auth.uid()) in (follower_id, followee_id));

-- Blocking also removes follows and pending requests between the pair.
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
  delete from public.follows
   where (follower_id = new.blocker_id and followee_id = new.blocked_id)
      or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  update public.connection_requests set status = 'cancelled', responded_at = now()
   where status = 'pending'
     and least(sender_id, recipient_id) = least(new.blocker_id, new.blocked_id)
     and greatest(sender_id, recipient_id) = greatest(new.blocker_id, new.blocked_id);
  return new;
end;
$$;

-- Generic helper used by every Stage C feature to raise notifications.
create or replace function public.notify(
  p_user uuid, p_kind text, p_title text, p_body text, p_data jsonb, p_dedupe text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, data, dedupe_key)
  values (p_user, p_kind, left(p_title, 120), left(p_body, 300), coalesce(p_data, '{}'::jsonb), p_dedupe)
  on conflict (user_id, dedupe_key) do nothing
$$;
revoke execute on function public.notify(uuid, text, text, text, jsonb, text) from public, anon, authenticated;

create or replace function public.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if not public.is_active_member(v) then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  return v;
end;
$$;
revoke execute on function public.require_member() from public, anon, authenticated;

create or replace function public.display_name_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(display_name, ''), username, 'Someone') from public.profiles where id = p_user
$$;
revoke execute on function public.display_name_of(uuid) from public, anon, authenticated;

-- Can p_viewer interact with p_target at all?
create or replace function public.can_interact(p_viewer uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer <> p_target
     and public.is_active_member(p_target)
     and not public.is_blocked_between(p_viewer, p_target)
$$;
revoke execute on function public.can_interact(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------
create or replace function public.send_connection_request(p_user uuid, p_message text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_existing public.connection_requests;
  v_id bigint;
begin
  if not public.can_interact(v_me, p_user) then
    raise exception 'USER_UNAVAILABLE' using errcode = 'PT404';
  end if;
  if public.are_connected(v_me, p_user) then
    return 'ALREADY_CONNECTED';
  end if;

  select * into v_existing from public.connection_requests
   where status = 'pending'
     and least(sender_id, recipient_id) = least(v_me, p_user)
     and greatest(sender_id, recipient_id) = greatest(v_me, p_user);
  if found then
    if v_existing.recipient_id = v_me then
      -- They already asked me: treat my request as accepting theirs.
      perform public.respond_connection_request(v_existing.id, true);
      return 'CONNECTED';
    end if;
    return 'ALREADY_REQUESTED';
  end if;

  if (select who_can_connect from public.profile_visibility where user_id = p_user) = 'nobody' then
    raise exception 'NOT_ACCEPTING_REQUESTS' using errcode = 'PT403';
  end if;

  perform public.check_rate_limit('connection_request', 30, 86400);

  insert into public.connection_requests (sender_id, recipient_id, message)
  values (v_me, p_user, nullif(btrim(coalesce(p_message, '')), ''))
  returning id into v_id;

  perform public.notify(p_user, 'connection_request',
    public.display_name_of(v_me) || ' wants to connect', coalesce(nullif(btrim(p_message), ''), 'Tap to respond.'),
    jsonb_build_object('screen', 'connections', 'tab', 'requests'), 'conn_req:' || v_id);
  return 'REQUESTED';
end;
$$;

create or replace function public.respond_connection_request(p_request_id bigint, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  r public.connection_requests;
begin
  select * into r from public.connection_requests where id = p_request_id for update;
  if not found or r.recipient_id <> v_me or r.status <> 'pending' then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'PT404';
  end if;
  update public.connection_requests
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = p_request_id;
  if p_accept then
    if public.is_blocked_between(r.sender_id, v_me) then
      raise exception 'USER_UNAVAILABLE' using errcode = 'PT404';
    end if;
    insert into public.connections (user_a, user_b)
    values (least(r.sender_id, v_me), greatest(r.sender_id, v_me))
    on conflict do nothing;
    perform public.notify(r.sender_id, 'connection_accepted',
      public.display_name_of(v_me) || ' accepted your connection request', 'You are now connected.',
      jsonb_build_object('screen', 'profile', 'id', v_me), 'conn_ok:' || p_request_id);
  end if;
end;
$$;

create or replace function public.cancel_connection_request(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.connection_requests set status = 'cancelled', responded_at = now()
   where id = p_request_id and sender_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'PT404';
  end if;
end;
$$;

create or replace function public.remove_connection(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.connections
   where user_a = least((select auth.uid()), p_user) and user_b = greatest((select auth.uid()), p_user)
$$;

-- ---------------------------------------------------------------------------
-- Follows
-- ---------------------------------------------------------------------------
create or replace function public.follow_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
begin
  if not public.can_interact(v_me, p_user) then
    raise exception 'USER_UNAVAILABLE' using errcode = 'PT404';
  end if;
  perform public.check_rate_limit('follow', 100, 86400);
  insert into public.follows (follower_id, followee_id) values (v_me, p_user) on conflict do nothing;
  if found then
    perform public.notify(p_user, 'follow', public.display_name_of(v_me) || ' started following you', 'Tap to see their profile.',
      jsonb_build_object('screen', 'profile', 'id', v_me), 'follow:' || v_me);
  end if;
end;
$$;

create or replace function public.unfollow_user(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.follows where follower_id = (select auth.uid()) and followee_id = p_user
$$;

-- Removes someone from my followers.
create or replace function public.remove_follower(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.follows where follower_id = p_user and followee_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Reading the graph
-- ---------------------------------------------------------------------------
create or replace function public.get_relationship(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_out bigint;
  v_in bigint;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if p_user = v_me or not public.can_interact(v_me, p_user) then
    return null;
  end if;
  select id into v_out from public.connection_requests
   where sender_id = v_me and recipient_id = p_user and status = 'pending';
  select id into v_in from public.connection_requests
   where sender_id = p_user and recipient_id = v_me and status = 'pending';
  return jsonb_build_object(
    'connected', public.are_connected(v_me, p_user),
    'following', exists (select 1 from public.follows where follower_id = v_me and followee_id = p_user),
    'followed_by', exists (select 1 from public.follows where follower_id = p_user and followee_id = v_me),
    'outgoing_request_id', v_out,
    'incoming_request_id', v_in,
    'accepts_requests', (select who_can_connect = 'everyone' from public.profile_visibility where user_id = p_user),
    'message_permission', (select who_can_message from public.profile_visibility where user_id = p_user)
  );
end;
$$;

create or replace function public.profile_stats(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null
      or (p_user <> (select auth.uid()) and not public.can_interact((select auth.uid()), p_user)) then null
    else jsonb_build_object(
      'followers', (select count(*) from public.follows f where f.followee_id = p_user and public.is_active_member(f.follower_id)),
      'following', (select count(*) from public.follows f where f.follower_id = p_user and public.is_active_member(f.followee_id)),
      'connections', case
        when public.can_view_field(p_user, (select auth.uid()),
               (select connections_list from public.profile_visibility where user_id = p_user))
        then (select count(*) from public.connections c where p_user in (c.user_a, c.user_b))
        else null end
    )
  end
$$;

-- Someone's connections, if their "who can see your connections" allows it.
create or replace function public.list_connections(p_user uuid, p_limit int default 50, p_offset int default 0)
returns table (id uuid, username text, display_name text, avatar_path text, is_verified boolean, connected_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if p_user <> v_me and (
       not public.can_interact(v_me, p_user)
       or not public.can_view_field(p_user, v_me, (select connections_list from public.profile_visibility where user_id = p_user))) then
    return;
  end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_path, p.is_verified, c.created_at
    from public.connections c
    join public.profiles p on p.id = case when c.user_a = p_user then c.user_b else c.user_a end
   where p_user in (c.user_a, c.user_b)
     and p.account_status = 'active'
     and not public.is_blocked_between(v_me, p.id)
   order by c.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.mutual_connections(p_user uuid)
returns table (id uuid, username text, display_name text, avatar_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_path
    from public.profiles p
   where (select auth.uid()) is not null
     and p_user <> (select auth.uid())
     and public.can_interact((select auth.uid()), p_user)
     and public.can_view_field(p_user, (select auth.uid()),
           (select connections_list from public.profile_visibility where user_id = p_user))
     and public.are_connected(p.id, (select auth.uid()))
     and public.are_connected(p.id, p_user)
     and p.account_status = 'active'
   order by p.display_name
   limit 50
$$;

create or replace function public.list_connection_requests(p_direction text)
returns table (request_id bigint, user_id uuid, username text, display_name text, avatar_path text, message text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, p.id, p.username, p.display_name, p.avatar_path, r.message, r.created_at
    from public.connection_requests r
    join public.profiles p on p.id = case when p_direction = 'incoming' then r.sender_id else r.recipient_id end
   where r.status = 'pending'
     and ((p_direction = 'incoming' and r.recipient_id = (select auth.uid()))
       or (p_direction = 'outgoing' and r.sender_id = (select auth.uid())))
     and p.account_status = 'active'
   order by r.created_at desc
   limit 200
$$;

create or replace function public.list_follows(p_direction text, p_limit int default 50, p_offset int default 0)
returns table (user_id uuid, username text, display_name text, avatar_path text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_path, f.created_at
    from public.follows f
    join public.profiles p on p.id = case when p_direction = 'followers' then f.follower_id else f.followee_id end
   where ((p_direction = 'followers' and f.followee_id = (select auth.uid()))
       or (p_direction = 'following' and f.follower_id = (select auth.uid())))
     and p.account_status = 'active'
   order by f.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

-- People you may know: friends of connections, then people from your town.
-- Never uses location data.
create or replace function public.suggested_people(p_limit int default 20)
returns table (id uuid, username text, display_name text, avatar_path text, home_region text, mutual_count int, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  my_conns as (
    select case when c.user_a = me.id then c.user_b else c.user_a end as uid
      from public.connections c, me where me.id in (c.user_a, c.user_b)
  ),
  fof as (
    select case when c.user_a = mc.uid then c.user_b else c.user_a end as uid, count(*)::int as mutual
      from public.connections c join my_conns mc on mc.uid in (c.user_a, c.user_b)
     group by 1
  ),
  my_region as (
    select lower(btrim(d.home_region)) as r from public.profile_details d, me where d.user_id = me.id
  ),
  candidates as (
    select uid, mutual, 'mutual'::text as reason from fof
    union all
    select d.user_id, 0, 'region' from public.profile_details d
      join public.profile_visibility v on v.user_id = d.user_id and v.home_region = 'public' and v.searchable
      , my_region
     where my_region.r <> '' and lower(btrim(d.home_region)) = my_region.r
  )
  select p.id, p.username, p.display_name, p.avatar_path,
         case when v.home_region = 'public' then d.home_region end,
         max(c.mutual), (array_agg(c.reason order by c.mutual desc))[1]
    from candidates c
    join public.profiles p on p.id = c.uid
    join public.profile_details d on d.user_id = p.id
    join public.profile_visibility v on v.user_id = p.id
    , me
   where p.id <> me.id
     and p.account_status = 'active' and p.onboarding_completed_at is not null
     and not public.are_connected(me.id, p.id)
     and not public.is_blocked_between(me.id, p.id)
     and not exists (select 1 from public.connection_requests r
                      where r.status = 'pending'
                        and least(r.sender_id, r.recipient_id) = least(me.id, p.id)
                        and greatest(r.sender_id, r.recipient_id) = greatest(me.id, p.id))
   group by p.id, p.username, p.display_name, p.avatar_path, v.home_region, d.home_region
   order by max(c.mutual) desc, p.display_name
   limit least(greatest(p_limit, 1), 50)
$$;

revoke execute on function
  public.send_connection_request(uuid, text), public.respond_connection_request(bigint, boolean),
  public.cancel_connection_request(bigint), public.remove_connection(uuid),
  public.follow_user(uuid), public.unfollow_user(uuid), public.remove_follower(uuid),
  public.get_relationship(uuid), public.profile_stats(uuid), public.list_connections(uuid, int, int),
  public.mutual_connections(uuid), public.list_connection_requests(text), public.list_follows(text, int, int),
  public.suggested_people(int)
  from public, anon;
grant execute on function
  public.send_connection_request(uuid, text), public.respond_connection_request(bigint, boolean),
  public.cancel_connection_request(bigint), public.remove_connection(uuid),
  public.follow_user(uuid), public.unfollow_user(uuid), public.remove_follower(uuid),
  public.get_relationship(uuid), public.profile_stats(uuid), public.list_connections(uuid, int, int),
  public.mutual_connections(uuid), public.list_connection_requests(text), public.list_follows(text, int, int),
  public.suggested_people(int)
  to authenticated;
