-- Stage D: reporting, moderation and admin tools.
--
-- * Any member can report a profile, post, comment, message, group, event or
--   notice they can see. The report stores a snapshot of the reported item
--   so evidence survives if the author deletes it. For messages, only the
--   single reported message is captured, never the rest of the conversation.
-- * Moderators (and admins) work the queue: dismiss, warn, remove content,
--   suspend for up to 30 days. Only admins can suspend indefinitely, remove
--   whole groups, manage roles and read the audit log.
-- * Every moderation action is written to audit_log and moderation_actions.
-- * Moderators can open photos attached to reported items, and only those.

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('profile', 'post', 'comment', 'message', 'group', 'event', 'notice')),
  target_id text not null,
  target_user_id uuid references public.profiles (id) on delete set null,
  reason text not null check (reason in (
    'harassment', 'hate', 'spam', 'scam', 'impersonation', 'sexual', 'violence',
    'self_harm', 'underage', 'privacy', 'other'
  )),
  details text not null default '' check (length(details) <= 1000),
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  handled_by uuid references public.profiles (id) on delete set null,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index reports_status_idx on public.reports (status, created_at);
create index reports_target_idx on public.reports (target_type, target_id);
create unique index reports_one_open_per_reporter on public.reports (reporter_id, target_type, target_id)
  where status in ('open', 'reviewing');

-- Suspensions and their end dates. Not readable by other members.
create table public.user_restrictions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  suspended_until timestamptz,          -- null with a row = indefinite
  reason text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  moderator_id uuid references public.profiles (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('warn', 'suspend', 'unsuspend', 'remove_content', 'dismiss', 'role_change')),
  target_type text,
  target_id text,
  report_id bigint references public.reports (id) on delete set null,
  reason text not null default '',
  until timestamptz,
  created_at timestamptz not null default now()
);
create index moderation_actions_user_idx on public.moderation_actions (user_id, created_at desc);

alter table public.reports enable row level security;
alter table public.user_restrictions enable row level security;
alter table public.moderation_actions enable row level security;
revoke all on public.reports, public.user_restrictions, public.moderation_actions from anon, authenticated;

grant select on public.user_restrictions to authenticated;
create policy "see my restriction" on public.user_restrictions
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('moderator') or public.has_role('admin')
$$;
revoke execute on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated;

create or replace function public.require_moderator()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_moderator() then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  return auth.uid();
end;
$$;
revoke execute on function public.require_moderator() from public, anon, authenticated;

create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_role('admin') then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  return auth.uid();
end;
$$;
revoke execute on function public.require_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------
create or replace function public.report_content(p_type text, p_id text, p_reason text, p_details text default '')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_snapshot jsonb;
  v_user uuid;
  v_id bigint;
begin
  -- Deactivated or suspended members can still report (e.g. what happened to them).
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if p_reason is null or p_reason not in ('harassment', 'hate', 'spam', 'scam', 'impersonation', 'sexual', 'violence',
                                          'self_harm', 'underage', 'privacy', 'other') then
    raise exception 'REPORT_INVALID' using errcode = '22023';
  end if;
  if length(coalesce(p_details, '')) > 1000 then
    raise exception 'REPORT_INVALID' using errcode = '22023';
  end if;

  begin
    case p_type
      when 'profile' then
        select jsonb_build_object('username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
                                  'bio', public.get_profile(p.id) ->> 'bio'), p.id
          into v_snapshot, v_user
          -- Allowed even after blocking: people often block first, then report.
          from public.profiles p where p.id = p_id::uuid and p.onboarding_completed_at is not null;
      when 'post' then
        select jsonb_build_object('body', p.body, 'visibility', p.visibility, 'group_id', p.group_id, 'created_at', p.created_at,
                                  'media', coalesce((select jsonb_agg(m.path order by m.position) from public.post_media m where m.post_id = p.id), '[]'::jsonb)),
               p.author_id
          into v_snapshot, v_user
          from public.posts p where p.id = p_id::uuid and public.can_view_post(p.id, v_me);
      when 'comment' then
        select jsonb_build_object('body', c.body, 'post_id', c.post_id, 'created_at', c.created_at), c.author_id
          into v_snapshot, v_user
          from public.post_comments c where c.id = p_id::bigint and c.deleted_at is null and public.can_view_post(c.post_id, v_me);
      when 'message' then
        select jsonb_build_object('body', m.body, 'kind', m.kind, 'conversation_id', m.conversation_id,
                                  'attachment_path', m.attachment_path, 'created_at', m.created_at), m.sender_id
          into v_snapshot, v_user
          from public.messages m
         where m.id = p_id::bigint and m.deleted_at is null and m.kind <> 'system'
           and exists (select 1 from public.conversation_members cm
                        where cm.conversation_id = m.conversation_id and cm.user_id = v_me
                          and m.created_at >= cm.joined_at);
      when 'group' then
        select jsonb_build_object('name', g.name, 'description', g.description, 'privacy', g.privacy), g.created_by
          into v_snapshot, v_user
          from public.groups g where g.id = p_id::uuid and public.can_see_group(g.id, v_me);
      when 'event' then
        select jsonb_build_object('title', e.title, 'description', e.description, 'starts_at', e.starts_at,
                                  'venue_name', e.venue_name, 'group_id', e.group_id), e.host_id
          into v_snapshot, v_user
          from public.events e where e.id = p_id::uuid and public.can_view_event(e.id, v_me);
      when 'notice' then
        select jsonb_build_object('title', n.title, 'body', n.body, 'category', n.category, 'region', n.region), n.author_id
          into v_snapshot, v_user
          from public.notices n where n.id = p_id::uuid and n.deleted_at is null and not public.is_blocked_between(v_me, n.author_id);
      else
        raise exception 'REPORT_INVALID' using errcode = '22023';
    end case;
  exception when invalid_text_representation then
    v_snapshot := null;
  end;

  if v_snapshot is null then
    raise exception 'REPORT_TARGET_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_user = v_me then
    raise exception 'REPORT_INVALID' using errcode = '22023';
  end if;

  select id into v_id from public.reports
   where reporter_id = v_me and target_type = p_type and target_id = p_id and status in ('open', 'reviewing');
  if v_id is not null then
    return v_id;  -- already reported; don't create duplicates
  end if;

  perform public.check_rate_limit('report', 20, 86400);
  insert into public.reports (reporter_id, target_type, target_id, target_user_id, reason, details, snapshot)
  values (v_me, p_type, p_id, v_user, p_reason, btrim(coalesce(p_details, '')), v_snapshot)
  returning id into v_id;
  return v_id;
end;
$$;

-- What happened to my reports (no details about the action taken against others).
create or replace function public.my_reports()
returns table (id bigint, target_type text, reason text, status text, created_at timestamptz, resolved_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.target_type, r.reason, r.status, r.created_at, r.resolved_at
    from public.reports r where r.reporter_id = (select auth.uid())
   order by r.created_at desc limit 100
$$;

-- Lets a suspended member see why and until when.
create or replace function public.my_restriction()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('suspended_until', r.suspended_until, 'reason', r.reason)
    from public.user_restrictions r
    join public.profiles p on p.id = r.user_id and p.account_status = 'suspended'
   where r.user_id = (select auth.uid())
$$;

-- Moderators may open photos attached to reported items, and nothing else.
create or replace function public.moderator_can_read_media(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_moderator() and exists (
    select 1 from public.reports r
     where (p_bucket = 'chat-media' and r.target_type = 'message' and r.snapshot ->> 'attachment_path' = p_name)
        or (p_bucket = 'post-media' and r.target_type = 'post' and r.snapshot -> 'media' ? p_name)
  )
$$;
revoke execute on function public.moderator_can_read_media(text, text) from public, anon;
grant execute on function public.moderator_can_read_media(text, text) to authenticated;

create policy "moderators read reported media"
  on storage.objects for select to authenticated
  using (bucket_id in ('chat-media', 'post-media') and public.moderator_can_read_media(bucket_id, name));

-- ---------------------------------------------------------------------------
-- Moderation queue
-- ---------------------------------------------------------------------------
create or replace function public.mod_list_reports(p_status text default 'open', p_limit int default 50, p_offset int default 0)
returns table (
  id bigint, target_type text, target_id text, reason text, details text, snapshot jsonb, status text,
  created_at timestamptz, reporter_username text, target_user_id uuid, target_username text,
  target_display_name text, target_account_status text, reports_on_target int, reports_on_user int,
  resolution_note text, handled_by_username text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_moderator();
  return query
  select r.id, r.target_type, r.target_id, r.reason, r.details, r.snapshot, r.status, r.created_at,
         rp.username, r.target_user_id, tp.username, tp.display_name, tp.account_status::text,
         (select count(*)::int from public.reports x where x.target_type = r.target_type and x.target_id = r.target_id),
         (select count(*)::int from public.reports x where x.target_user_id = r.target_user_id),
         r.resolution_note, hp.username
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles tp on tp.id = r.target_user_id
    left join public.profiles hp on hp.id = r.handled_by
   where case when p_status = 'all' then true
              when p_status = 'open' then r.status in ('open', 'reviewing')
              else r.status = p_status end
   -- Safety-critical reasons first, then oldest first.
   order by (r.reason in ('self_harm', 'underage', 'violence')) desc,
            case when p_status = 'open' then r.created_at end asc,
            r.created_at desc
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.mod_open_report_count()
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_moderator();
  return (select count(*)::int from public.reports where status in ('open', 'reviewing'));
end;
$$;

-- p_status: 'reviewing', 'actioned' or 'dismissed'. Closing a report also
-- closes the other open reports on the same item.
create or replace function public.mod_resolve_report(p_report bigint, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mod uuid := public.require_moderator();
  r public.reports;
begin
  if p_status not in ('reviewing', 'actioned', 'dismissed') then
    raise exception 'REPORT_INVALID' using errcode = '22023';
  end if;
  select * into r from public.reports where id = p_report;
  if r.id is null then
    raise exception 'REPORT_NOT_FOUND' using errcode = 'PT404';
  end if;
  update public.reports
     set status = p_status, handled_by = v_mod,
         resolution_note = coalesce(nullif(btrim(p_note), ''), resolution_note),
         resolved_at = case when p_status = 'reviewing' then null else now() end
   where (id = p_report)
      or (p_status <> 'reviewing' and target_type = r.target_type and target_id = r.target_id and status in ('open', 'reviewing'));
  if p_status = 'dismissed' then
    insert into public.moderation_actions (moderator_id, user_id, action, target_type, target_id, report_id, reason)
    values (v_mod, r.target_user_id, 'dismiss', r.target_type, r.target_id, p_report, coalesce(p_note, ''));
  end if;
  perform public.write_audit('report_' || p_status, 'report', p_report::text,
    jsonb_build_object('target_type', r.target_type, 'target_id', r.target_id, 'note', p_note));
end;
$$;

-- Removes reported content and tells the author why.
create or replace function public.mod_remove_content(p_type text, p_id text, p_reason text, p_report bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mod uuid := public.require_moderator();
  v_author uuid;
  v_label text;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  case p_type
    when 'post' then
      update public.posts set deleted_at = now() where id = p_id::uuid and deleted_at is null returning author_id into v_author;
      v_label := 'post';
    when 'comment' then
      update public.post_comments set deleted_at = now(), body = '[removed]' where id = p_id::bigint and deleted_at is null
      returning author_id into v_author;
      v_label := 'comment';
    when 'message' then
      update public.messages set deleted_at = now(), body = null, attachment_meta = null
       where id = p_id::bigint and deleted_at is null returning sender_id into v_author;
      v_label := 'message';
    when 'notice' then
      update public.notices set deleted_at = now() where id = p_id::uuid and deleted_at is null returning author_id into v_author;
      v_label := 'notice';
    when 'event' then
      update public.events set cancelled_at = now() where id = p_id::uuid and cancelled_at is null returning host_id into v_author;
      v_label := 'event';
    when 'group' then
      if not public.has_role('admin') then
        raise exception 'NOT_ALLOWED' using errcode = 'PT403';
      end if;
      delete from public.groups where id = p_id::uuid returning created_by into v_author;
      v_label := 'group';
    else
      raise exception 'REPORT_INVALID' using errcode = '22023';
  end case;
  if not found then
    raise exception 'REPORT_TARGET_NOT_FOUND' using errcode = 'PT404';
  end if;

  insert into public.moderation_actions (moderator_id, user_id, action, target_type, target_id, report_id, reason)
  values (v_mod, v_author, 'remove_content', p_type, p_id, p_report, btrim(p_reason));
  perform public.write_audit('content_removed', p_type, p_id, jsonb_build_object('reason', p_reason, 'report', p_report));
  if v_author is not null then
    perform public.notify(v_author, 'security', 'Content removed',
      'Your ' || v_label || ' was removed for breaking the community guidelines: ' || left(btrim(p_reason), 200),
      jsonb_build_object('screen', 'notifications'), 'modrm:' || p_type || ':' || p_id);
  end if;
  if p_report is not null then
    perform public.mod_resolve_report(p_report, 'actioned', p_reason);
  end if;
end;
$$;

create or replace function public.mod_warn_user(p_user uuid, p_reason text, p_report bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mod uuid := public.require_moderator();
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  insert into public.moderation_actions (moderator_id, user_id, action, report_id, reason)
  values (v_mod, p_user, 'warn', p_report, btrim(p_reason));
  perform public.write_audit('user_warned', 'profile', p_user::text, jsonb_build_object('reason', p_reason, 'report', p_report));
  perform public.notify(p_user, 'security', 'A warning from NearMalayali moderators', left(btrim(p_reason), 280),
    jsonb_build_object('screen', 'notifications'), 'modwarn:' || extract(epoch from now())::bigint);
  if p_report is not null then
    perform public.mod_resolve_report(p_report, 'actioned', p_reason);
  end if;
end;
$$;

-- p_days null = indefinite (admins only). Moderators can suspend for 1–30 days
-- and cannot suspend other moderators or admins.
create or replace function public.mod_suspend_user(p_user uuid, p_days int, p_reason text, p_report bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mod uuid := public.require_moderator();
  v_admin boolean := public.has_role('admin');
  v_until timestamptz := case when p_days is null then null else now() + make_interval(days => p_days) end;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  if p_user = v_mod
     or (not v_admin and (p_days is null or p_days not between 1 and 30))
     or (p_days is not null and p_days not between 1 and 3650)
     or (not v_admin and exists (select 1 from public.user_roles where user_id = p_user)) then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  update public.profiles set account_status = 'suspended' where id = p_user and account_status <> 'suspended';
  insert into public.user_restrictions (user_id, suspended_until, reason, created_by)
  values (p_user, v_until, btrim(p_reason), v_mod)
  on conflict (user_id) do update
    set suspended_until = excluded.suspended_until, reason = excluded.reason, created_by = excluded.created_by, created_at = now();
  -- End their sessions on other devices by removing push tokens; the app
  -- shows the suspension screen on its next request.
  delete from public.push_tokens where user_id = p_user;
  insert into public.moderation_actions (moderator_id, user_id, action, report_id, reason, until)
  values (v_mod, p_user, 'suspend', p_report, btrim(p_reason), v_until);
  perform public.write_audit('user_suspended', 'profile', p_user::text,
    jsonb_build_object('reason', p_reason, 'until', v_until, 'report', p_report));
  if p_report is not null then
    perform public.mod_resolve_report(p_report, 'actioned', p_reason);
  end if;
end;
$$;

create or replace function public.mod_unsuspend_user(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mod uuid := public.require_moderator();
begin
  -- Moderators can lift suspensions they could have made; indefinite ones need an admin.
  if not public.has_role('admin')
     and exists (select 1 from public.user_restrictions where user_id = p_user and suspended_until is null) then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';
  end if;
  update public.profiles set account_status = 'active' where id = p_user and account_status = 'suspended';
  if not found then
    raise exception 'USER_UNAVAILABLE' using errcode = 'PT404';
  end if;
  delete from public.user_restrictions where user_id = p_user;
  insert into public.moderation_actions (moderator_id, user_id, action, reason)
  values (v_mod, p_user, 'unsuspend', coalesce(btrim(p_reason), ''));
  perform public.write_audit('user_unsuspended', 'profile', p_user::text, jsonb_build_object('reason', p_reason));
end;
$$;

-- Ends timed suspensions. Scheduled every 15 minutes.
create or replace function public.lift_expired_suspensions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with ended as (
    delete from public.user_restrictions
     where suspended_until is not null and suspended_until <= now()
    returning user_id
  )
  update public.profiles p set account_status = 'active'
    from ended where p.id = ended.user_id and p.account_status = 'suspended';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.lift_expired_suspensions() from public, anon, authenticated;

create or replace function public.mod_find_users(p_query text)
returns table (id uuid, username text, display_name text, account_status text, created_at timestamptz,
               reports_against int, roles text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  perform public.require_moderator();
  if length(v_q) < 2 then
    return;
  end if;
  return query
  select p.id, p.username, p.display_name, p.account_status::text, p.created_at,
         (select count(*)::int from public.reports r where r.target_user_id = p.id),
         coalesce((select array_agg(ur.role::text) from public.user_roles ur where ur.user_id = p.id), '{}')
    from public.profiles p
   where p.username like replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or lower(p.display_name) like '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by p.username
   limit 50;
end;
$$;

create or replace function public.mod_user_summary(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_moderator();
  return (
    select jsonb_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
      'account_status', p.account_status, 'created_at', p.created_at,
      'roles', coalesce((select jsonb_agg(ur.role) from public.user_roles ur where ur.user_id = p.id), '[]'::jsonb),
      'restriction', (select jsonb_build_object('suspended_until', r.suspended_until, 'reason', r.reason)
                        from public.user_restrictions r where r.user_id = p.id),
      'reports_against', (select count(*) from public.reports r where r.target_user_id = p.id),
      'open_reports_against', (select count(*) from public.reports r where r.target_user_id = p.id and r.status in ('open', 'reviewing')),
      'reports_made', (select count(*) from public.reports r where r.reporter_id = p.id),
      'actions', coalesce((
        select jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'until', a.until,
                                            'target_type', a.target_type, 'created_at', a.created_at,
                                            'moderator', mp.username) order by a.created_at desc)
          from (select * from public.moderation_actions x where x.user_id = p.id order by x.created_at desc limit 30) a
          left join public.profiles mp on mp.id = a.moderator_id), '[]'::jsonb)
    )
    from public.profiles p where p.id = p_user
  );
end;
$$;

create or replace function public.admin_set_role(p_user uuid, p_role public.app_role, p_grant boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_admin();
begin
  if not p_grant and p_role = 'admin' and p_user = v_admin then
    raise exception 'NOT_ALLOWED' using errcode = 'PT403';  -- avoid locking everyone out
  end if;
  if p_grant then
    insert into public.user_roles (user_id, role) values (p_user, p_role) on conflict do nothing;
  else
    delete from public.user_roles where user_id = p_user and role = p_role;
  end if;
  insert into public.moderation_actions (moderator_id, user_id, action, reason)
  values (v_admin, p_user, 'role_change', case when p_grant then 'granted ' else 'removed ' end || p_role::text);
  perform public.write_audit(case when p_grant then 'role_granted' else 'role_removed' end, 'profile', p_user::text,
    jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.admin_audit_log(p_before bigint default null, p_limit int default 100)
returns table (id bigint, actor_username text, action text, target_type text, target_id text, details jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select a.id, p.username, a.action, a.target_type, a.target_id, a.details, a.created_at
    from public.audit_log a left join public.profiles p on p.id = a.actor_id
   where p_before is null or a.id < p_before
   order by a.id desc
   limit least(greatest(p_limit, 1), 500);
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('lift-suspensions', '*/15 * * * *', 'select public.lift_expired_suspensions()');
  else
    raise notice 'pg_cron not available; schedule public.lift_expired_suspensions() every 15 minutes';
  end if;
end $$;

revoke execute on function
  public.report_content(text, text, text, text), public.my_reports(), public.my_restriction(),
  public.mod_list_reports(text, int, int), public.mod_open_report_count(), public.mod_resolve_report(bigint, text, text),
  public.mod_remove_content(text, text, text, bigint), public.mod_warn_user(uuid, text, bigint),
  public.mod_suspend_user(uuid, int, text, bigint), public.mod_unsuspend_user(uuid, text),
  public.mod_find_users(text), public.mod_user_summary(uuid), public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_audit_log(bigint, int)
  from public, anon;
grant execute on function
  public.report_content(text, text, text, text), public.my_reports(), public.my_restriction(),
  public.mod_list_reports(text, int, int), public.mod_open_report_count(), public.mod_resolve_report(bigint, text, text),
  public.mod_remove_content(text, text, text, bigint), public.mod_warn_user(uuid, text, bigint),
  public.mod_suspend_user(uuid, int, text, bigint), public.mod_unsuspend_user(uuid, text),
  public.mod_find_users(text), public.mod_user_summary(uuid), public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_audit_log(bigint, int)
  to authenticated;
