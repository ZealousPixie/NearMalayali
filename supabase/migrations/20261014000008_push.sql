-- Stage B: push tokens and the push delivery queue.
--
-- Flow: a notification row is inserted with push_status = 'pending'. The
-- send-push Edge Function claims pending rows (claim_push_batch), sends them
-- through Expo's push service (APNs / FCM) and records the real outcome
-- (complete_push). Nothing is marked 'sent' unless Expo accepted it.
-- The function is triggered every minute by pg_cron, and immediately after
-- each insert when pg_net is available.

create table public.push_tokens (
  token text primary key check (length(token) between 10 and 300),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;
grant select on public.push_tokens to authenticated;
create policy "see own push tokens" on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));

-- A device token belongs to whoever is signed in on that device now.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  perform public.check_rate_limit('register_push_token', 20, 3600);
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, auth.uid(), p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end;
$$;

-- Called on sign-out so the device stops receiving this account's alerts.
create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and user_id = (select auth.uid())
$$;

-- Which preference column governs each notification kind.
create or replace function public.notification_pref_allows(p_user uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select np.push_enabled and case p_kind
      when 'proximity' then np.proximity
      when 'connection_request' then np.connection_requests
      when 'connection_accepted' then np.connection_accepted
      when 'message' then np.messages
      when 'follow' then np.follows
      when 'reaction' then np.reactions_comments
      when 'comment' then np.reactions_comments
      when 'group_invite' then np.group_invites
      when 'group_activity' then np.group_activity
      when 'event_invite' then np.event_invites
      when 'event_reminder' then np.event_reminders
      when 'security' then np.security
      else false
    end
    from public.notification_preferences np where np.user_id = p_user
  ), false)
$$;

-- Service-role only: claim up to p_limit pending notifications. Rows whose
-- owner has push turned off for that kind, or who has no device, are marked
-- 'skipped' (they still show in the in-app notification centre).
create or replace function public.claim_push_batch(p_limit int default 100)
returns table (
  notification_id bigint,
  user_id uuid,
  kind text,
  title text,
  body text,
  data jsonb,
  show_previews boolean,
  tokens text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Give up on rows stuck in 'sending' (e.g. function crashed) after 10 min.
  update public.notifications n
     set push_status = case when n.push_attempts >= 3 then 'failed' else 'pending' end,
         push_error = coalesce(n.push_error, 'TIMED_OUT')
   where n.push_status = 'sending' and n.pushed_at < now() - interval '10 minutes';

  -- Don't push stale news.
  update public.notifications n
     set push_status = 'skipped', push_error = 'EXPIRED'
   where n.push_status = 'pending' and n.created_at < now() - interval '1 hour';

  update public.notifications n
     set push_status = 'skipped', push_error = 'DISABLED_OR_NO_DEVICE'
   where n.push_status = 'pending'
     and (not public.notification_pref_allows(n.user_id, n.kind)
          or not exists (select 1 from public.push_tokens t where t.user_id = n.user_id));

  return query
  with claimed as (
    select n.id from public.notifications n
     where n.push_status = 'pending'
     order by n.created_at
     limit least(greatest(p_limit, 1), 500)
     for update skip locked
  ), marked as (
    update public.notifications n
       set push_status = 'sending', push_attempts = n.push_attempts + 1, pushed_at = now()
      from claimed c where n.id = c.id
    returning n.id, n.user_id, n.kind, n.title, n.body, n.data
  )
  select m.id, m.user_id, m.kind, m.title, m.body, m.data,
         coalesce(np.show_previews, false),
         array(select t.token from public.push_tokens t where t.user_id = m.user_id)
    from marked m
    left join public.notification_preferences np on np.user_id = m.user_id;
end;
$$;

-- Service-role only: record the real outcome of a push.
create or replace function public.complete_push(p_notification_id bigint, p_ok boolean, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set push_status = case
           when p_ok then 'sent'
           when push_attempts >= 3 then 'failed'
           else 'pending'
         end,
         push_error = case when p_ok then null else left(p_error, 300) end,
         pushed_at = now()
   where id = p_notification_id and push_status = 'sending'
$$;

-- Service-role only: forget tokens Expo says are no longer valid.
create or replace function public.remove_push_tokens(p_tokens text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = any (p_tokens)
$$;

revoke execute on function
  public.register_push_token(text, text), public.unregister_push_token(text),
  public.notification_pref_allows(uuid, text), public.claim_push_batch(int),
  public.complete_push(bigint, boolean, text), public.remove_push_tokens(text[])
  from public, anon, authenticated;
grant execute on function public.register_push_token(text, text), public.unregister_push_token(text) to authenticated;
grant execute on function public.claim_push_batch(int), public.complete_push(bigint, boolean, text),
  public.remove_push_tokens(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- Triggering the send-push function. Needs, in the hosted project:
--   * extensions pg_net and pg_cron enabled
--   * two Vault secrets: 'project_url' (https://<ref>.supabase.co) and
--     'push_dispatch_secret' (same value as the function's
--     PUSH_DISPATCH_SECRET env var)
-- Without them the queue simply waits; nothing is reported as sent.
-- ---------------------------------------------------------------------------
create or replace function public.kick_push_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    return;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'project_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret'$q$ into v_secret;
  if v_url is null or v_secret is null then
    return;
  end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb)$q$
    using v_url || '/functions/v1/send-push',
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
end;
$$;
revoke execute on function public.kick_push_dispatch() from public, anon, authenticated;

create or replace function public.on_notification_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.kick_push_dispatch();
  return null;
end;
$$;
revoke execute on function public.on_notification_created() from public, anon, authenticated;

create trigger notifications_kick_push after insert on public.notifications
  for each statement execute function public.on_notification_created();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('push-dispatch', '* * * * *', 'select public.kick_push_dispatch()');
  end if;
end $$;
