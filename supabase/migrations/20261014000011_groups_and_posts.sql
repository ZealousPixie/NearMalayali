-- Stage C: community groups, posts and the feed.
--
-- Groups: 'public' (anyone can join), 'approval' (visible; admins approve
-- requests), 'private' (hidden; invitation only). Each group has a linked
-- group chat whose membership follows the group.
--
-- Posts: visible to everyone ('public'), to connections ('connections'), or to
-- a group ('group'). Photos live in the private 'post-media' bucket and are
-- served through short-lived signed links only to people who can see the post.

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 3 and 80),
  description text not null default '' check (length(description) <= 2000),
  privacy text not null default 'public' check (privacy in ('public', 'approval', 'private')),
  region text not null default '' check (length(region) <= 80),
  created_by uuid references public.profiles (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now()
);
create index groups_name_idx on public.groups (lower(name));

alter table public.conversations
  add constraint conversations_group_fk foreign key (group_id) references public.groups (id) on delete cascade;

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'moderator', 'member')),
  status text not null check (status in ('active', 'requested', 'invited', 'banned')),
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id, status);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
revoke all on public.groups, public.group_members from anon, authenticated;

create or replace function public.group_role(p_group uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.group_members where group_id = p_group and user_id = p_user and status = 'active'
$$;
revoke execute on function public.group_role(uuid, uuid) from public, anon, authenticated;

create or replace function public.is_group_admin(p_group uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.group_role(p_group, p_user) in ('owner', 'admin'), false)
$$;
revoke execute on function public.is_group_admin(uuid, uuid) from public, anon, authenticated;

create or replace function public.can_see_group(p_group uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.groups g
     where g.id = p_group
       and (g.privacy <> 'private'
            or exists (select 1 from public.group_members m
                        where m.group_id = g.id and m.user_id = p_user and m.status in ('active', 'invited')))
       and not exists (select 1 from public.group_members b
                        where b.group_id = g.id and b.user_id = p_user and b.status = 'banned')
  )
$$;
revoke execute on function public.can_see_group(uuid, uuid) from public, anon;
grant execute on function public.can_see_group(uuid, uuid) to authenticated;

grant select on public.groups to authenticated;
create policy "visible groups" on public.groups
  for select to authenticated using (public.can_see_group(id, (select auth.uid())));

-- Members of a group see its active member list; everyone sees their own rows.
grant select on public.group_members to authenticated;
create policy "group members visible to members" on public.group_members
  for select to authenticated using (
    user_id = (select auth.uid())
    or (status = 'active' and public.group_role(group_id, (select auth.uid())) is not null)
    or (status = 'requested' and public.is_group_admin(group_id, (select auth.uid())))
  );

-- Keeps the linked group chat in step with group membership.
create or replace function public.sync_group_chat(p_group uuid, p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
begin
  select conversation_id into v_conv from public.groups where id = p_group;
  if v_conv is null then
    return;
  end if;
  if p_active then
    insert into public.conversation_members (conversation_id, user_id, status)
    values (v_conv, p_user, 'active')
    on conflict (conversation_id, user_id) do update set status = 'active', joined_at = now()
      where public.conversation_members.status <> 'active';
  else
    update public.conversation_members set status = 'removed'
     where conversation_id = v_conv and user_id = p_user and status in ('active', 'request');
  end if;
end;
$$;
revoke execute on function public.sync_group_chat(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.create_group(p_name text, p_description text, p_privacy text, p_region text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_id uuid;
  v_conv uuid;
begin
  if p_name is null or length(btrim(p_name)) not between 3 and 80 then
    raise exception 'GROUP_NAME_INVALID' using errcode = '22023';
  end if;
  if p_privacy not in ('public', 'approval', 'private') then
    raise exception 'GROUP_PRIVACY_INVALID' using errcode = '22023';
  end if;
  perform public.check_rate_limit('create_group', 3, 86400);
  insert into public.groups (name, description, privacy, region, created_by)
  values (btrim(p_name), coalesce(btrim(p_description), ''), p_privacy, coalesce(btrim(p_region), ''), v_me)
  returning id into v_id;
  insert into public.conversations (kind, title, created_by, group_id) values ('group', btrim(p_name), v_me, v_id)
  returning id into v_conv;
  update public.groups set conversation_id = v_conv where id = v_id;
  insert into public.group_members (group_id, user_id, role, status) values (v_id, v_me, 'owner', 'active');
  insert into public.conversation_members (conversation_id, user_id, role) values (v_conv, v_me, 'admin');
  return v_id;
end;
$$;

create or replace function public.update_group(p_group uuid, p_name text, p_description text, p_privacy text, p_region text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_group_admin(p_group, auth.uid()) then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  if p_name is null or length(btrim(p_name)) not between 3 and 80 then
    raise exception 'GROUP_NAME_INVALID' using errcode = '22023';
  end if;
  if p_privacy not in ('public', 'approval', 'private') then
    raise exception 'GROUP_PRIVACY_INVALID' using errcode = '22023';
  end if;
  update public.groups
     set name = btrim(p_name), description = coalesce(btrim(p_description), ''), privacy = p_privacy,
         region = coalesce(btrim(p_region), '')
   where id = p_group;
  update public.conversations set title = btrim(p_name) where group_id = p_group;
end;
$$;

-- Returns 'JOINED', 'REQUESTED' or 'ALREADY_MEMBER'.
create or replace function public.join_group(p_group uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  g public.groups;
  v_status text;
  a record;
begin
  select * into g from public.groups where id = p_group;
  if g.id is null or not public.can_see_group(p_group, v_me) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'PT404';
  end if;
  select status into v_status from public.group_members where group_id = p_group and user_id = v_me;
  if v_status = 'active' then
    return 'ALREADY_MEMBER';
  elsif v_status = 'requested' then
    return 'REQUESTED';
  end if;
  perform public.check_rate_limit('join_group', 30, 86400);

  if g.privacy = 'public' or v_status = 'invited' then
    insert into public.group_members (group_id, user_id, status) values (p_group, v_me, 'active')
    on conflict (group_id, user_id) do update set status = 'active', joined_at = now();
    perform public.sync_group_chat(p_group, v_me, true);
    return 'JOINED';
  elsif g.privacy = 'approval' then
    insert into public.group_members (group_id, user_id, status) values (p_group, v_me, 'requested');
    for a in select user_id from public.group_members where group_id = p_group and status = 'active' and role in ('owner', 'admin') loop
      perform public.notify(a.user_id, 'group_activity', g.name, public.display_name_of(v_me) || ' asked to join',
        jsonb_build_object('screen', 'group', 'id', p_group, 'tab', 'requests'), 'grpreq:' || p_group || ':' || v_me);
    end loop;
    return 'REQUESTED';
  end if;
  raise exception 'GROUP_NOT_FOUND' using errcode = 'PT404';
end;
$$;

create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_role text := public.group_role(p_group, auth.uid());
  v_next uuid;
begin
  delete from public.group_members where group_id = p_group and user_id = v_me and status in ('active', 'requested', 'invited');
  if not found then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'PT404';
  end if;
  perform public.sync_group_chat(p_group, v_me, false);
  if v_role = 'owner' then
    -- Hand ownership to the longest-standing admin, else the longest-standing member.
    select user_id into v_next from public.group_members
     where group_id = p_group and status = 'active'
     order by (role = 'admin') desc, joined_at limit 1;
    if v_next is null then
      delete from public.groups where id = p_group;  -- last person out
    else
      update public.group_members set role = 'owner' where group_id = p_group and user_id = v_next;
    end if;
  end if;
end;
$$;

create or replace function public.respond_join_request(p_group uuid, p_user uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_group_admin(p_group, auth.uid()) then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  if p_accept then
    update public.group_members set status = 'active', joined_at = now()
     where group_id = p_group and user_id = p_user and status = 'requested';
    if not found then
      raise exception 'REQUEST_NOT_FOUND' using errcode = 'PT404';
    end if;
    perform public.sync_group_chat(p_group, p_user, true);
    perform public.notify(p_user, 'group_activity', (select name from public.groups where id = p_group),
      'Your request to join was accepted', jsonb_build_object('screen', 'group', 'id', p_group), 'grpok:' || p_group);
  else
    delete from public.group_members where group_id = p_group and user_id = p_user and status = 'requested';
    if not found then
      raise exception 'REQUEST_NOT_FOUND' using errcode = 'PT404';
    end if;
  end if;
end;
$$;

-- Members invite their connections. In private groups only admins invite.
create or replace function public.invite_to_group(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  g public.groups;
begin
  select * into g from public.groups where id = p_group;
  if public.group_role(p_group, v_me) is null
     or (g.privacy = 'private' and not public.is_group_admin(p_group, v_me)) then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  if not public.are_connected(v_me, p_user) or not public.can_interact(v_me, p_user) then
    raise exception 'USER_UNAVAILABLE' using errcode = 'PT404';
  end if;
  perform public.check_rate_limit('group_invite', 50, 86400);
  insert into public.group_members (group_id, user_id, status, invited_by) values (p_group, p_user, 'invited', v_me)
  on conflict (group_id, user_id) do nothing;
  if found then
    perform public.notify(p_user, 'group_invite', g.name, public.display_name_of(v_me) || ' invited you to join',
      jsonb_build_object('screen', 'group', 'id', p_group), 'grpinv:' || p_group);
  end if;
end;
$$;

create or replace function public.decline_group_invite(p_group uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.group_members where group_id = p_group and user_id = (select auth.uid()) and status = 'invited'
$$;

-- Admins remove (optionally ban) members; moderators may remove plain members.
create or replace function public.remove_group_member(p_group uuid, p_user uuid, p_ban boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_role text := public.group_role(p_group, auth.uid());
  v_their_role text;
begin
  select role into v_their_role from public.group_members where group_id = p_group and user_id = p_user;
  if p_user = auth.uid() or v_my_role is null or v_their_role = 'owner'
     or (v_my_role = 'moderator' and (v_their_role <> 'member' or p_ban))
     or (v_my_role = 'admin' and v_their_role = 'admin')
     or v_my_role = 'member' then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  if p_ban then
    update public.group_members set status = 'banned', role = 'member' where group_id = p_group and user_id = p_user;
  else
    delete from public.group_members where group_id = p_group and user_id = p_user;
  end if;
  perform public.sync_group_chat(p_group, p_user, false);
  perform public.write_audit('group_member_removed', 'group', p_group::text,
    jsonb_build_object('user', p_user, 'banned', p_ban));
end;
$$;

create or replace function public.set_group_role(p_group uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.group_role(p_group, auth.uid()) <> 'owner' or p_user = auth.uid()
     or p_role not in ('admin', 'moderator', 'member') then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  update public.group_members set role = p_role where group_id = p_group and user_id = p_user and status = 'active';
  if not found then
    raise exception 'USER_UNAVAILABLE' using errcode = 'PT404';
  end if;
  update public.conversation_members set role = case when p_role = 'admin' then 'admin' else 'member' end
   where conversation_id = (select conversation_id from public.groups where id = p_group) and user_id = p_user;
end;
$$;

create or replace function public.list_groups(p_scope text default 'discover', p_query text default null, p_limit int default 30, p_offset int default 0)
returns table (id uuid, name text, description text, privacy text, region text, member_count int, my_status text, my_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.description, g.privacy, g.region,
         (select count(*)::int from public.group_members m where m.group_id = g.id and m.status = 'active'),
         me.status, me.role
    from public.groups g
    left join public.group_members me on me.group_id = g.id and me.user_id = (select auth.uid())
   where public.can_see_group(g.id, (select auth.uid()))
     and case when p_scope = 'mine' then me.status in ('active', 'invited', 'requested')
              else true end
     and (p_query is null or length(btrim(p_query)) < 2
          or g.name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or g.region ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by (me.status = 'invited') desc nulls last,
            (select count(*) from public.group_members m where m.group_id = g.id and m.status = 'active') desc,
            g.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

create or replace function public.group_details(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.can_see_group(g.id, (select auth.uid())) then jsonb_build_object(
    'id', g.id, 'name', g.name, 'description', g.description, 'privacy', g.privacy, 'region', g.region,
    'created_at', g.created_at,
    'conversation_id', case when me.status = 'active' then g.conversation_id end,
    'member_count', (select count(*) from public.group_members m where m.group_id = g.id and m.status = 'active'),
    'my_status', me.status, 'my_role', me.role,
    'pending_requests', case when me.role in ('owner', 'admin') and me.status = 'active'
      then (select count(*) from public.group_members m where m.group_id = g.id and m.status = 'requested') end
  ) end
    from public.groups g
    left join public.group_members me on me.group_id = g.id and me.user_id = (select auth.uid())
   where g.id = p_group
$$;

create or replace function public.list_group_members(p_group uuid, p_status text default 'active')
returns table (user_id uuid, username text, display_name text, avatar_path text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_path, m.role, m.joined_at
    from public.group_members m
    join public.profiles p on p.id = m.user_id
   where m.group_id = p_group
     and m.status = case when p_status = 'requested' then 'requested' else 'active' end
     and case when p_status = 'requested' then public.is_group_admin(p_group, (select auth.uid()))
              else public.group_role(p_group, (select auth.uid())) is not null end
     and p.account_status = 'active'
     and (p.id = (select auth.uid()) or not public.is_blocked_between((select auth.uid()), p.id))
   order by case m.role when 'owner' then 0 when 'admin' then 1 when 'moderator' then 2 else 3 end, p.display_name
   limit 500
$$;

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  visibility text not null check (visibility in ('public', 'connections', 'group')),
  group_id uuid references public.groups (id) on delete cascade,
  body text not null default '' check (length(body) <= 5000),
  shared_post_id uuid references public.posts (id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint posts_group_visibility check ((visibility = 'group') = (group_id is not null))
);
create index posts_author_idx on public.posts (author_id, created_at desc);
create index posts_group_idx on public.posts (group_id, created_at desc) where group_id is not null;
create index posts_created_idx on public.posts (created_at desc, id desc);

create table public.post_media (
  post_id uuid not null references public.posts (id) on delete cascade,
  position smallint not null check (position between 0 and 3),
  path text not null unique,
  width int,
  height int,
  primary key (post_id, position)
);

create table public.post_reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.post_comments (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  parent_id bigint references public.post_comments (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index post_comments_post_idx on public.post_comments (post_id, id);

create table public.bookmarks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_comments enable row level security;
alter table public.bookmarks enable row level security;
revoke all on public.posts, public.post_media, public.post_reactions, public.post_comments, public.bookmarks
  from anon, authenticated;

create or replace function public.can_view_post(p_post uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
     where p.id = p_post and p.deleted_at is null
       and p_viewer is not null
       and (p.author_id = p_viewer
            or (public.is_active_member(p.author_id)
                and not public.is_blocked_between(p_viewer, p.author_id)
                and case p.visibility
                      when 'public' then true
                      when 'connections' then public.are_connected(p_viewer, p.author_id)
                      when 'group' then public.group_role(p.group_id, p_viewer) is not null
                        or (select privacy from public.groups where id = p.group_id) = 'public'
                    end))
  )
$$;
revoke execute on function public.can_view_post(uuid, uuid) from public, anon;
grant execute on function public.can_view_post(uuid, uuid) to authenticated;

grant select on public.posts to authenticated;
create policy "viewable posts" on public.posts
  for select to authenticated using (public.can_view_post(id, (select auth.uid())));
grant select on public.post_media to authenticated;
create policy "media of viewable posts" on public.post_media
  for select to authenticated using (public.can_view_post(post_id, (select auth.uid())));
grant select on public.post_reactions to authenticated;
create policy "reactions on viewable posts" on public.post_reactions
  for select to authenticated using (
    public.can_view_post(post_id, (select auth.uid()))
    and not public.is_blocked_between((select auth.uid()), user_id));
grant select on public.post_comments to authenticated;
create policy "comments on viewable posts" on public.post_comments
  for select to authenticated using (
    public.can_view_post(post_id, (select auth.uid()))
    and (author_id is null or not public.is_blocked_between((select auth.uid()), author_id)));
grant select, insert, delete on public.bookmarks to authenticated;
create policy "own bookmarks" on public.bookmarks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "bookmark viewable posts" on public.bookmarks
  for insert to authenticated with check (user_id = (select auth.uid()) and public.can_view_post(post_id, (select auth.uid())));
create policy "remove own bookmarks" on public.bookmarks
  for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.create_post(
  p_body text,
  p_visibility text default 'public',
  p_group uuid default null,
  p_media jsonb default '[]'::jsonb,  -- [{ "path": "...", "width": 1, "height": 1 }]
  p_shared_post uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_item jsonb;
  v_pos int := 0;
begin
  if p_visibility not in ('public', 'connections', 'group') or ((p_visibility = 'group') <> (p_group is not null)) then
    raise exception 'VISIBILITY_INVALID' using errcode = '22023';
  end if;
  if p_group is not null and public.group_role(p_group, v_me) is null then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  if jsonb_typeof(coalesce(p_media, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_media, '[]'::jsonb)) > 4 then
    raise exception 'MEDIA_INVALID' using errcode = '22023';
  end if;
  if v_body = '' and jsonb_array_length(coalesce(p_media, '[]'::jsonb)) = 0 and p_shared_post is null then
    raise exception 'POST_EMPTY' using errcode = '22023';
  end if;
  if length(v_body) > 5000 then
    raise exception 'POST_TOO_LONG' using errcode = '22023';
  end if;
  -- Only public posts can be shared, so sharing never widens an audience.
  if p_shared_post is not null and not exists (
       select 1 from public.posts where id = p_shared_post and visibility = 'public' and deleted_at is null
          and public.can_view_post(id, v_me)) then
    raise exception 'SHARE_NOT_ALLOWED' using errcode = 'PT403';
  end if;
  perform public.check_rate_limit('create_post', 20, 86400);

  insert into public.posts (author_id, visibility, group_id, body, shared_post_id)
  values (v_me, p_visibility, p_group, v_body, p_shared_post)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) loop
    -- Media must have been uploaded by me into my own folder.
    if (v_item ->> 'path') is null or (v_item ->> 'path') not like v_me::text || '/%'
       or not exists (select 1 from storage.objects o
                       where o.bucket_id = 'post-media' and o.name = v_item ->> 'path' and o.owner = v_me) then
      raise exception 'MEDIA_INVALID' using errcode = '22023';
    end if;
    insert into public.post_media (post_id, position, path, width, height)
    values (v_id, v_pos, v_item ->> 'path', (v_item ->> 'width')::int, (v_item ->> 'height')::int);
    v_pos := v_pos + 1;
  end loop;
  return v_id;
end;
$$;

create or replace function public.edit_post(p_post uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(btrim(coalesce(p_body, ''))) > 5000 then
    raise exception 'POST_TOO_LONG' using errcode = '22023';
  end if;
  update public.posts set body = btrim(coalesce(p_body, '')), edited_at = now()
   where id = p_post and author_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'POST_NOT_FOUND' using errcode = 'PT404';
  end if;
end;
$$;

-- Authors delete their posts; group admins and moderators can remove group
-- posts. Returns media paths so the app can delete the files.
create or replace function public.delete_post(p_post uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.posts;
  v_paths text[];
begin
  select * into p from public.posts where id = p_post and deleted_at is null;
  if p.id is null or not (
       p.author_id = auth.uid()
       or (p.group_id is not null and public.group_role(p.group_id, auth.uid()) in ('owner', 'admin', 'moderator'))) then
    raise exception 'POST_NOT_FOUND' using errcode = 'PT404';
  end if;
  select coalesce(array_agg(path), '{}') into v_paths from public.post_media where post_id = p_post;
  update public.posts set deleted_at = now(), body = '' where id = p_post;
  delete from public.post_media where post_id = p_post;
  if p.author_id <> auth.uid() then
    perform public.write_audit('group_post_removed', 'post', p_post::text, jsonb_build_object('group', p.group_id));
    -- Media belongs to the author's folder; only they (or the service) can remove the files.
    return '{}';
  end if;
  return v_paths;
end;
$$;

create or replace function public.react_to_post(p_post uuid, p_emoji text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_author uuid;
begin
  if not public.can_view_post(p_post, v_me) then
    raise exception 'POST_NOT_FOUND' using errcode = 'PT404';
  end if;
  if p_emoji is null then
    delete from public.post_reactions where post_id = p_post and user_id = v_me;
    return;
  end if;
  insert into public.post_reactions (post_id, user_id, emoji) values (p_post, v_me, p_emoji)
  on conflict (post_id, user_id) do update set emoji = excluded.emoji;
  select author_id into v_author from public.posts where id = p_post;
  if v_author <> v_me then
    perform public.notify(v_author, 'reaction', public.display_name_of(v_me) || ' reacted to your post', p_emoji,
      jsonb_build_object('screen', 'post', 'id', p_post), 'react:' || p_post || ':' || v_me);
  end if;
end;
$$;

create or replace function public.comment_on_post(p_post uuid, p_body text, p_parent bigint default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_id bigint;
  v_author uuid;
  v_parent_author uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.can_view_post(p_post, v_me) then
    raise exception 'POST_NOT_FOUND' using errcode = 'PT404';
  end if;
  if length(v_body) not between 1 and 2000 then
    raise exception 'COMMENT_INVALID' using errcode = '22023';
  end if;
  if p_parent is not null then
    select author_id into v_parent_author from public.post_comments
     where id = p_parent and post_id = p_post and parent_id is null and deleted_at is null;
    if not found then
      raise exception 'COMMENT_INVALID' using errcode = '22023';
    end if;
  end if;
  perform public.check_rate_limit('comment', 60, 3600);
  insert into public.post_comments (post_id, author_id, parent_id, body) values (p_post, v_me, p_parent, v_body)
  returning id into v_id;

  select author_id into v_author from public.posts where id = p_post;
  if v_author <> v_me then
    perform public.notify(v_author, 'comment', public.display_name_of(v_me) || ' commented on your post', left(v_body, 200),
      jsonb_build_object('screen', 'post', 'id', p_post), 'comment:' || v_id);
  end if;
  if v_parent_author is not null and v_parent_author <> v_me and v_parent_author <> v_author
     and not public.is_blocked_between(v_me, v_parent_author) then
    perform public.notify(v_parent_author, 'comment', public.display_name_of(v_me) || ' replied to your comment', left(v_body, 200),
      jsonb_build_object('screen', 'post', 'id', p_post), 'reply:' || v_id);
  end if;
  return v_id;
end;
$$;

-- Comment authors, post authors and group moderators can delete comments.
create or replace function public.delete_comment(p_comment bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cm public.post_comments;
  p public.posts;
begin
  select * into cm from public.post_comments where id = p_comment and deleted_at is null;
  select * into p from public.posts where id = cm.post_id;
  if cm.id is null or not (
       cm.author_id = auth.uid() or p.author_id = auth.uid()
       or (p.group_id is not null and public.group_role(p.group_id, auth.uid()) in ('owner', 'admin', 'moderator'))) then
    raise exception 'COMMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  update public.post_comments set deleted_at = now(), body = '[deleted]' where id = p_comment;
end;
$$;

-- One row per post, with everything a feed card needs.
create or replace function public.post_cards(p_ids uuid[])
returns table (
  id uuid, author_id uuid, author_username text, author_name text, author_avatar text, author_verified boolean,
  visibility text, group_id uuid, group_name text, body text, created_at timestamptz, edited_at timestamptz,
  media jsonb, reaction_count int, comment_count int, my_reaction text, bookmarked boolean,
  shared jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, a.id, a.username, a.display_name, a.avatar_path, a.is_verified,
         p.visibility, p.group_id, g.name, p.body, p.created_at, p.edited_at,
         coalesce((select jsonb_agg(jsonb_build_object('path', m.path, 'width', m.width, 'height', m.height) order by m.position)
                     from public.post_media m where m.post_id = p.id), '[]'::jsonb),
         (select count(*)::int from public.post_reactions r where r.post_id = p.id
            and not public.is_blocked_between((select auth.uid()), r.user_id)),
         (select count(*)::int from public.post_comments c where c.post_id = p.id and c.deleted_at is null
            and (c.author_id is null or not public.is_blocked_between((select auth.uid()), c.author_id))),
         (select r.emoji from public.post_reactions r where r.post_id = p.id and r.user_id = (select auth.uid())),
         exists (select 1 from public.bookmarks b where b.post_id = p.id and b.user_id = (select auth.uid())),
         case when p.shared_post_id is null then null
              when public.can_view_post(p.shared_post_id, (select auth.uid())) then (
                select jsonb_build_object('id', s.id, 'body', s.body, 'author_name', sa.display_name,
                                          'author_username', sa.username, 'created_at', s.created_at,
                                          'media', coalesce((select jsonb_agg(jsonb_build_object('path', m.path, 'width', m.width, 'height', m.height) order by m.position)
                                                               from public.post_media m where m.post_id = s.id), '[]'::jsonb))
                  from public.posts s join public.profiles sa on sa.id = s.author_id where s.id = p.shared_post_id)
              else jsonb_build_object('unavailable', true) end
    from unnest(p_ids) with ordinality as x(pid, ord)
    join public.posts p on p.id = x.pid
    join public.profiles a on a.id = p.author_id
    left join public.groups g on g.id = p.group_id
   where public.can_view_post(p.id, (select auth.uid()))
   order by x.ord
$$;
revoke execute on function public.post_cards(uuid[]) from public, anon, authenticated;

-- Home feed: my posts, my connections' posts, public posts of people I
-- follow, and posts in my groups. Newest first; keyset pagination.
create or replace function public.home_feed(p_before timestamptz default null, p_before_id uuid default null, p_limit int default 20)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_ids uuid[];
begin
  select array_agg(id order by created_at desc, id desc) into v_ids from (
    select p.id, p.created_at
      from public.posts p
     where p.deleted_at is null
       and (p_before is null or (p.created_at, p.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
       and (
         p.author_id = v_me
         or (p.visibility in ('public', 'connections') and public.are_connected(v_me, p.author_id))
         or (p.visibility = 'public' and exists (select 1 from public.follows f where f.follower_id = v_me and f.followee_id = p.author_id))
         or (p.visibility = 'group' and exists (select 1 from public.group_members m
                                                 where m.group_id = p.group_id and m.user_id = v_me and m.status = 'active'))
       )
       and public.can_view_post(p.id, v_me)
     order by p.created_at desc, p.id desc
     limit least(greatest(p_limit, 1), 50)
  ) t;
  return query select to_jsonb(c) from public.post_cards(coalesce(v_ids, '{}')) c;
end;
$$;

-- Posts by one member (what I'm allowed to see), a group's posts, or my bookmarks.
create or replace function public.list_posts(
  p_scope text, p_target uuid default null,
  p_before timestamptz default null, p_before_id uuid default null, p_limit int default 20
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_ids uuid[];
begin
  if p_scope = 'bookmarks' then
    select array_agg(post_id order by created_at desc) into v_ids from (
      select b.post_id, b.created_at from public.bookmarks b
       where b.user_id = v_me and public.can_view_post(b.post_id, v_me)
         and (p_before is null or b.created_at < p_before)
       order by b.created_at desc limit least(greatest(p_limit, 1), 50)) t;
  else
    select array_agg(id order by created_at desc, id desc) into v_ids from (
      select p.id, p.created_at from public.posts p
       where p.deleted_at is null
         and case p_scope when 'user' then p.author_id = p_target and p.visibility <> 'group'
                          when 'group' then p.group_id = p_target
                          else false end
         and (p_before is null or (p.created_at, p.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
         and public.can_view_post(p.id, v_me)
       order by p.created_at desc, p.id desc
       limit least(greatest(p_limit, 1), 50)) t;
  end if;
  return query select to_jsonb(c) from public.post_cards(coalesce(v_ids, '{}')) c;
end;
$$;

create or replace function public.get_post(p_post uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(c) from public.post_cards(array[p_post]) c
$$;

create or replace function public.list_comments(p_post uuid)
returns table (id bigint, parent_id bigint, author_id uuid, author_name text, author_username text, author_avatar text,
               body text, created_at timestamptz, deleted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.parent_id, a.id, coalesce(a.display_name, 'Former member'), a.username, a.avatar_path,
         case when c.deleted_at is null then c.body else '' end, c.created_at, c.deleted_at is not null
    from public.post_comments c
    left join public.profiles a on a.id = c.author_id and a.account_status = 'active'
   where c.post_id = p_post
     and public.can_view_post(p_post, (select auth.uid()))
     and (c.author_id is null or not public.is_blocked_between((select auth.uid()), c.author_id))
   order by coalesce(c.parent_id, c.id), c.id
   limit 500
$$;

-- ---------------------------------------------------------------------------
-- Post media: private bucket, path "<author id>/<file>".
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 10 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "post media: own folder upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "post media: owner or viewers read"
  on storage.objects for select to authenticated
  using (bucket_id = 'post-media' and (
    owner = (select auth.uid())
    or exists (select 1 from public.post_media m
                where m.path = storage.objects.name and public.can_view_post(m.post_id, (select auth.uid())))));

create policy "post media: owner deletes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and owner = (select auth.uid()));

revoke execute on function
  public.create_group(text, text, text, text), public.update_group(uuid, text, text, text, text),
  public.join_group(uuid), public.leave_group(uuid), public.respond_join_request(uuid, uuid, boolean),
  public.invite_to_group(uuid, uuid), public.decline_group_invite(uuid),
  public.remove_group_member(uuid, uuid, boolean), public.set_group_role(uuid, uuid, text),
  public.list_groups(text, text, int, int), public.group_details(uuid), public.list_group_members(uuid, text),
  public.create_post(text, text, uuid, jsonb, uuid), public.edit_post(uuid, text), public.delete_post(uuid),
  public.react_to_post(uuid, text), public.comment_on_post(uuid, text, bigint), public.delete_comment(bigint),
  public.home_feed(timestamptz, uuid, int), public.list_posts(text, uuid, timestamptz, uuid, int),
  public.get_post(uuid), public.list_comments(uuid)
  from public, anon;
grant execute on function
  public.create_group(text, text, text, text), public.update_group(uuid, text, text, text, text),
  public.join_group(uuid), public.leave_group(uuid), public.respond_join_request(uuid, uuid, boolean),
  public.invite_to_group(uuid, uuid), public.decline_group_invite(uuid),
  public.remove_group_member(uuid, uuid, boolean), public.set_group_role(uuid, uuid, text),
  public.list_groups(text, text, int, int), public.group_details(uuid), public.list_group_members(uuid, text),
  public.create_post(text, text, uuid, jsonb, uuid), public.edit_post(uuid, text), public.delete_post(uuid),
  public.react_to_post(uuid, text), public.comment_on_post(uuid, text, bigint), public.delete_comment(bigint),
  public.home_feed(timestamptz, uuid, int), public.list_posts(text, uuid, timestamptz, uuid, int),
  public.get_post(uuid), public.list_comments(uuid)
  to authenticated;
