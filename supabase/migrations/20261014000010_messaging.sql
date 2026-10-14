-- Stage C: private messaging and group chats.
--
-- Encryption: messages are encrypted in transit (TLS) and at rest (Supabase
-- disk encryption). They are NOT end-to-end encrypted: the service operator
-- could technically read them. The app and privacy policy say so.
--
-- Access: every read goes through RLS (membership); every write goes through
-- SECURITY DEFINER functions that check membership, blocks and message
-- permissions. Media lives in a private bucket readable only by members.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text check (title is null or length(title) between 1 and 80),
  created_by uuid references public.profiles (id) on delete set null,
  -- For direct chats: "<smaller uuid>:<larger uuid>", so a pair has one chat.
  direct_key text unique,
  -- Set when the chat belongs to a community group (Stage C groups).
  group_id uuid,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint conversations_direct_has_key check ((kind = 'direct') = (direct_key is not null))
);
create index conversations_last_message_idx on public.conversations (last_message_at desc);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  -- request: a message request the member hasn't accepted yet.
  status text not null default 'active' check (status in ('active', 'request', 'left', 'removed')),
  muted_until timestamptz,
  last_read_message_id bigint,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id, status);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'image', 'video', 'system')),
  body text check (body is null or length(body) <= 4000),
  reply_to_id bigint references public.messages (id) on delete set null,
  attachment_path text,
  attachment_meta jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index messages_conversation_idx on public.messages (conversation_id, id desc);

create table public.message_reactions (
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
revoke all on public.conversations, public.conversation_members, public.messages, public.message_reactions
  from anon, authenticated;

create or replace function public.is_conversation_member(p_conversation uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation and user_id = p_user and status in ('active', 'request')
  )
$$;
revoke execute on function public.is_conversation_member(uuid, uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

grant select on public.conversations to authenticated;
create policy "members see conversations" on public.conversations
  for select to authenticated using (public.is_conversation_member(id, (select auth.uid())));

grant select on public.conversation_members to authenticated;
create policy "members see co-members" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id, (select auth.uid())));

grant select on public.messages to authenticated;
-- Members see messages sent since they joined.
create policy "members read messages" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.conversation_members m
       where m.conversation_id = messages.conversation_id
         and m.user_id = (select auth.uid())
         and m.status in ('active', 'request')
         and messages.created_at >= m.joined_at
    )
  );

grant select on public.message_reactions to authenticated;
create policy "members read reactions" on public.message_reactions
  for select to authenticated using (
    exists (select 1 from public.messages msg
             where msg.id = message_reactions.message_id
               and public.is_conversation_member(msg.conversation_id, (select auth.uid())))
  );

-- Realtime: stream new messages / reactions / membership changes to members
-- (Supabase applies the SELECT policies above to realtime too).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.message_reactions,
      public.conversation_members, public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Message permission: may p_sender start a chat with p_recipient?
-- Returns 'active' (goes straight to the inbox), 'request', or raises.
-- ---------------------------------------------------------------------------
create or replace function public.direct_message_status(p_sender uuid, p_recipient uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_perm public.message_permission;
begin
  if not public.can_interact(p_sender, p_recipient) then
    raise exception 'USER_UNAVAILABLE' using errcode = 'PT404';
  end if;
  if public.are_connected(p_sender, p_recipient) then
    return 'active';
  end if;
  select who_can_message into v_perm from public.profile_visibility where user_id = p_recipient;
  if v_perm = 'everyone' then
    return 'active';
  elsif v_perm = 'requests' then
    return 'request';
  end if;
  raise exception 'MESSAGES_RESTRICTED' using errcode = 'PT403';
end;
$$;
revoke execute on function public.direct_message_status(uuid, uuid) from public, anon, authenticated;

create or replace function public.start_direct_conversation(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_key text := least(v_me, p_user)::text || ':' || greatest(v_me, p_user)::text;
  v_id uuid;
  v_status text;
begin
  v_status := public.direct_message_status(v_me, p_user);
  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is null then
    perform public.check_rate_limit('start_conversation', 30, 86400);
    insert into public.conversations (kind, created_by, direct_key) values ('direct', v_me, v_key)
      returning id into v_id;
    insert into public.conversation_members (conversation_id, user_id, status) values
      (v_id, v_me, 'active'),
      (v_id, p_user, v_status);
  else
    -- Re-opening a chat I left: rejoin without old history.
    update public.conversation_members set status = 'active', joined_at = now()
     where conversation_id = v_id and user_id = v_me and status in ('left', 'removed');
  end if;
  return v_id;
end;
$$;

create or replace function public.create_group_conversation(p_title text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_id uuid;
  v_user uuid;
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 80 then
    raise exception 'TITLE_INVALID' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_members), 0) < 1 or cardinality(p_members) > 100 then
    raise exception 'MEMBERS_INVALID' using errcode = '22023';
  end if;
  perform public.check_rate_limit('create_group_chat', 10, 86400);
  insert into public.conversations (kind, title, created_by) values ('group', btrim(p_title), v_me) returning id into v_id;
  insert into public.conversation_members (conversation_id, user_id, role) values (v_id, v_me, 'admin');
  foreach v_user in array p_members loop
    -- Only your connections can be added directly, to prevent spam groups.
    if v_user <> v_me and public.are_connected(v_me, v_user) and public.can_interact(v_me, v_user) then
      insert into public.conversation_members (conversation_id, user_id) values (v_id, v_user) on conflict do nothing;
    end if;
  end loop;
  insert into public.messages (conversation_id, sender_id, kind, body)
  values (v_id, v_me, 'system', public.display_name_of(v_me) || ' created the group');
  return v_id;
end;
$$;

create or replace function public.send_message(
  p_conversation uuid,
  p_body text default null,
  p_kind text default 'text',
  p_reply_to bigint default null,
  p_attachment_path text default null,
  p_attachment_meta jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_conv public.conversations;
  v_member public.conversation_members;
  v_other uuid;
  v_id bigint;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  r record;
  v_sender_name text;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  select * into v_member from public.conversation_members where conversation_id = p_conversation and user_id = v_me;
  if v_conv.id is null or v_member.user_id is null or v_member.status not in ('active', 'request') then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'PT404';
  end if;
  if p_kind not in ('text', 'image', 'video') then
    raise exception 'MESSAGE_INVALID' using errcode = '22023';
  end if;
  if p_kind = 'text' and (v_body is null or p_attachment_path is not null) then
    raise exception 'MESSAGE_INVALID' using errcode = '22023';
  end if;
  if p_kind in ('image', 'video') and (p_attachment_path is null
       or p_attachment_path not like (p_conversation::text || '/%')) then
    raise exception 'ATTACHMENT_INVALID' using errcode = '22023';
  end if;
  if length(coalesce(v_body, '')) > 4000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = '22023';
  end if;
  if p_reply_to is not null and not exists (
       select 1 from public.messages where id = p_reply_to and conversation_id = p_conversation) then
    raise exception 'REPLY_INVALID' using errcode = '22023';
  end if;

  if v_conv.kind = 'direct' then
    select user_id into v_other from public.conversation_members
     where conversation_id = p_conversation and user_id <> v_me;
    if v_other is null or not public.can_interact(v_me, v_other) then
      raise exception 'USER_UNAVAILABLE' using errcode = 'PT404';
    end if;
    -- A recipient who hasn't accepted a request gets at most 3 messages.
    if (select status from public.conversation_members where conversation_id = p_conversation and user_id = v_other) = 'request'
       and (select count(*) from public.messages where conversation_id = p_conversation and sender_id = v_me) >= 3 then
      raise exception 'REQUEST_PENDING' using errcode = 'PT403';
    end if;
  end if;

  perform public.check_rate_limit('send_message', 60, 60);

  -- Replying to a request accepts it.
  if v_member.status = 'request' then
    update public.conversation_members set status = 'active'
     where conversation_id = p_conversation and user_id = v_me;
  end if;

  insert into public.messages (conversation_id, sender_id, kind, body, reply_to_id, attachment_path, attachment_meta)
  values (p_conversation, v_me, p_kind, v_body, p_reply_to, p_attachment_path, p_attachment_meta)
  returning id into v_id;

  update public.conversations set last_message_at = now() where id = p_conversation;
  update public.conversation_members set last_read_message_id = v_id
   where conversation_id = p_conversation and user_id = v_me;

  v_sender_name := public.display_name_of(v_me);
  for r in
    select m.user_id, m.status from public.conversation_members m
     where m.conversation_id = p_conversation and m.user_id <> v_me
       and m.status in ('active', 'request')
       and (m.muted_until is null or m.muted_until < now())
       and not public.is_blocked_between(v_me, m.user_id)
  loop
    if r.status = 'request' then
      perform public.notify(r.user_id, 'message', 'New message request',
        v_sender_name || ' wants to message you',
        jsonb_build_object('screen', 'conversation', 'id', p_conversation), 'msgreq:' || p_conversation);
    else
      perform public.notify(r.user_id, 'message',
        case when v_conv.kind = 'group' then coalesce(v_conv.title, 'Group') else v_sender_name end,
        case when v_conv.kind = 'group' then v_sender_name || ': ' else '' end
          || case p_kind when 'image' then 'sent a photo' when 'video' then 'sent a video' else left(v_body, 200) end,
        jsonb_build_object('screen', 'conversation', 'id', p_conversation), 'msg:' || v_id);
    end if;
  end loop;

  return v_id;
end;
$$;

-- "Unsend": removes the content for everyone and leaves a placeholder.
-- Returns the attachment path so the app can delete the file from storage.
create or replace function public.delete_message(p_message_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  select attachment_path into v_path from public.messages
   where id = p_message_id and sender_id = auth.uid() and deleted_at is null and kind <> 'system'
   for update;
  if not found then
    raise exception 'MESSAGE_NOT_FOUND' using errcode = 'PT404';
  end if;
  update public.messages
     set deleted_at = now(), body = null, attachment_meta = null, attachment_path = null
   where id = p_message_id;
  delete from public.message_reactions where message_id = p_message_id;
  return v_path;
end;
$$;

create or replace function public.react_to_message(p_message_id bigint, p_emoji text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_conv uuid;
begin
  select conversation_id into v_conv from public.messages where id = p_message_id and deleted_at is null;
  if v_conv is null or not public.is_conversation_member(v_conv, v_me) then
    raise exception 'MESSAGE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if p_emoji is null then
    delete from public.message_reactions where message_id = p_message_id and user_id = v_me;
  else
    insert into public.message_reactions (message_id, user_id, emoji) values (p_message_id, v_me, p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation uuid, p_message_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_members
     set last_read_message_id = greatest(coalesce(last_read_message_id, 0), p_message_id)
   where conversation_id = p_conversation and user_id = (select auth.uid())
$$;

create or replace function public.respond_message_request(p_conversation uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_members
     set status = case when p_accept then 'active' else 'left' end
   where conversation_id = p_conversation and user_id = auth.uid() and status = 'request';
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'PT404';
  end if;
end;
$$;

create or replace function public.mute_conversation(p_conversation uuid, p_until timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_members set muted_until = p_until
   where conversation_id = p_conversation and user_id = (select auth.uid())
$$;

create or replace function public.leave_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_kind text;
begin
  select kind into v_kind from public.conversations where id = p_conversation;
  update public.conversation_members set status = 'left'
   where conversation_id = p_conversation and user_id = v_me and status in ('active', 'request');
  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_kind = 'group' then
    insert into public.messages (conversation_id, sender_id, kind, body)
    values (p_conversation, v_me, 'system', public.display_name_of(v_me) || ' left');
    -- Keep at least one admin.
    if not exists (select 1 from public.conversation_members
                    where conversation_id = p_conversation and role = 'admin' and status = 'active') then
      update public.conversation_members set role = 'admin'
       where (conversation_id, user_id) = (
         select conversation_id, user_id from public.conversation_members
          where conversation_id = p_conversation and status = 'active' order by joined_at limit 1);
    end if;
  end if;
end;
$$;

create or replace function public.is_conversation_admin(p_conversation uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.conversation_members
                  where conversation_id = p_conversation and user_id = p_user and role = 'admin' and status = 'active')
$$;
revoke execute on function public.is_conversation_admin(uuid, uuid) from public, anon, authenticated;

create or replace function public.add_conversation_members(p_conversation uuid, p_users uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
  v_user uuid;
  v_added int := 0;
begin
  if not public.is_conversation_admin(p_conversation, v_me)
     or (select kind from public.conversations where id = p_conversation) <> 'group'
     or (select group_id from public.conversations where id = p_conversation) is not null then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  foreach v_user in array p_users loop
    if public.are_connected(v_me, v_user) and public.can_interact(v_me, v_user) then
      insert into public.conversation_members (conversation_id, user_id) values (p_conversation, v_user)
      on conflict (conversation_id, user_id) do update set status = 'active', joined_at = now()
        where public.conversation_members.status in ('left', 'removed');
      if found then
        v_added := v_added + 1;
        insert into public.messages (conversation_id, sender_id, kind, body)
        values (p_conversation, v_me, 'system', public.display_name_of(v_me) || ' added ' || public.display_name_of(v_user));
      end if;
    end if;
  end loop;
  return v_added;
end;
$$;

create or replace function public.remove_conversation_member(p_conversation uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_member();
begin
  if not public.is_conversation_admin(p_conversation, v_me) or p_user = v_me
     or (select group_id from public.conversations where id = p_conversation) is not null then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  update public.conversation_members set status = 'removed'
   where conversation_id = p_conversation and user_id = p_user and status = 'active';
  insert into public.messages (conversation_id, sender_id, kind, body)
  values (p_conversation, v_me, 'system', public.display_name_of(v_me) || ' removed ' || public.display_name_of(p_user));
end;
$$;

create or replace function public.set_conversation_admin(p_conversation uuid, p_user uuid, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_conversation_admin(p_conversation, auth.uid())
     or (select group_id from public.conversations where id = p_conversation) is not null then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  update public.conversation_members set role = case when p_admin then 'admin' else 'member' end
   where conversation_id = p_conversation and user_id = p_user and status = 'active';
end;
$$;

create or replace function public.rename_conversation(p_conversation uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_conversation_admin(p_conversation, auth.uid())
     or p_title is null or length(btrim(p_title)) not between 1 and 80 then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  update public.conversations set title = btrim(p_title) where id = p_conversation and kind = 'group';
end;
$$;

-- Inbox: one row per conversation with the latest message and unread count.
create or replace function public.list_conversations(p_status text default 'active')
returns table (
  conversation_id uuid,
  kind text,
  title text,
  other_user_id uuid,
  other_username text,
  avatar_path text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count int,
  muted boolean,
  my_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind,
         case when c.kind = 'direct' then op.display_name else c.title end,
         op.id, op.username, op.avatar_path,
         c.last_message_at,
         (select case when lm.deleted_at is not null then 'Message deleted'
                      when lm.kind = 'image' then '📷 Photo'
                      when lm.kind = 'video' then '🎬 Video'
                      else left(lm.body, 120) end
            from public.messages lm
           where lm.conversation_id = c.id and lm.created_at >= me.joined_at
           order by lm.id desc limit 1),
         (select count(*)::int from public.messages um
           where um.conversation_id = c.id and um.id > coalesce(me.last_read_message_id, 0)
             and um.created_at >= me.joined_at
             and um.sender_id is distinct from me.user_id and um.kind <> 'system'),
         me.muted_until is not null and me.muted_until > now(),
         me.status
    from public.conversation_members me
    join public.conversations c on c.id = me.conversation_id
    left join public.conversation_members om
      on c.kind = 'direct' and om.conversation_id = c.id and om.user_id <> me.user_id
    left join public.profiles op on op.id = om.user_id
   where me.user_id = (select auth.uid())
     and me.status = case when p_status = 'requests' then 'request' else 'active' end
     and (c.kind = 'group' or (op.id is not null and op.account_status = 'active'
                               and not public.is_blocked_between(me.user_id, op.id)))
     and exists (select 1 from public.messages x where x.conversation_id = c.id and x.created_at >= me.joined_at)
   order by c.last_message_at desc
   limit 200
$$;

create or replace function public.unread_message_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(unread_count), 0)::int from public.list_conversations('active') where not muted
$$;

-- Simple search across my conversations.
create or replace function public.search_messages(p_query text)
returns table (message_id bigint, conversation_id uuid, body text, created_at timestamptz, sender_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if length(v_q) < 2 then
    return;
  end if;
  return query
  select m.id, m.conversation_id, m.body, m.created_at, p.display_name
    from public.messages m
    join public.conversation_members me
      on me.conversation_id = m.conversation_id and me.user_id = auth.uid() and me.status in ('active', 'request')
    left join public.profiles p on p.id = m.sender_id
   where m.deleted_at is null and m.kind = 'text' and m.created_at >= me.joined_at
     and m.body ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by m.id desc
   limit 50;
end;
$$;

-- Read state for receipts: only shared if BOTH people allow read receipts.
create or replace function public.conversation_read_state(p_conversation uuid)
returns table (user_id uuid, last_read_message_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.last_read_message_id
    from public.conversation_members m
   where m.conversation_id = p_conversation
     and public.is_conversation_member(p_conversation, (select auth.uid()))
     and m.user_id <> (select auth.uid())
     and m.status = 'active'
     and (select read_receipts from public.profile_visibility where user_id = (select auth.uid()))
     and (select read_receipts from public.profile_visibility v where v.user_id = m.user_id)
$$;

revoke execute on function
  public.start_direct_conversation(uuid), public.create_group_conversation(text, uuid[]),
  public.send_message(uuid, text, text, bigint, text, jsonb), public.delete_message(bigint),
  public.react_to_message(bigint, text), public.mark_conversation_read(uuid, bigint),
  public.respond_message_request(uuid, boolean), public.mute_conversation(uuid, timestamptz),
  public.leave_conversation(uuid), public.add_conversation_members(uuid, uuid[]),
  public.remove_conversation_member(uuid, uuid), public.set_conversation_admin(uuid, uuid, boolean),
  public.rename_conversation(uuid, text), public.list_conversations(text), public.unread_message_count(),
  public.search_messages(text), public.conversation_read_state(uuid)
  from public, anon;
grant execute on function
  public.start_direct_conversation(uuid), public.create_group_conversation(text, uuid[]),
  public.send_message(uuid, text, text, bigint, text, jsonb), public.delete_message(bigint),
  public.react_to_message(bigint, text), public.mark_conversation_read(uuid, bigint),
  public.respond_message_request(uuid, boolean), public.mute_conversation(uuid, timestamptz),
  public.leave_conversation(uuid), public.add_conversation_members(uuid, uuid[]),
  public.remove_conversation_member(uuid, uuid), public.set_conversation_admin(uuid, uuid, boolean),
  public.rename_conversation(uuid, text), public.list_conversations(text), public.unread_message_count(),
  public.search_messages(text), public.conversation_read_state(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Chat media: private bucket, path "<conversation id>/<file>".
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 25 * 1024 * 1024,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_conversation_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (string_to_array(p_name, '/'))[1]::uuid;
exception when others then
  return null;
end;
$$;

create policy "chat media: members read"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-media'
         and public.is_conversation_member(public.storage_conversation_id(name), (select auth.uid())));

create policy "chat media: active members upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media'
              and exists (select 1 from public.conversation_members m
                           where m.conversation_id = public.storage_conversation_id(name)
                             and m.user_id = (select auth.uid()) and m.status in ('active', 'request')));

create policy "chat media: uploader deletes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and owner = (select auth.uid()));
