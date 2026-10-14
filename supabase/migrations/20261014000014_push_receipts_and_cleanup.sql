-- Stage D: push delivery receipts and storage cleanup.
--
-- Push: Expo's first response (a "ticket") only means Expo accepted the
-- message. About 15 minutes later Expo can report whether Apple/Google
-- accepted it (a "receipt"). We now store tickets, check receipts, and mark
-- notifications 'delivered' (accepted by Apple/Google) or 'failed'. Even
-- 'delivered' cannot prove the phone displayed it: the operating system and
-- the member's settings decide that.
--
-- Cleanup: files whose message or post was deleted (or whose upload was never
-- used) are removed by the cleanup-media Edge Function, which asks
-- orphaned_media() what to delete.

alter table public.notifications drop constraint if exists notifications_push_status_check;
alter table public.notifications add constraint notifications_push_status_check
  check (push_status in ('pending', 'sending', 'sent', 'delivered', 'failed', 'skipped'));

create table public.push_tickets (
  ticket_id text primary key,
  notification_id bigint not null references public.notifications (id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  receipt_status text check (receipt_status in ('ok', 'error', 'expired')),
  receipt_error text,
  checked_at timestamptz
);
create index push_tickets_unchecked_idx on public.push_tickets (created_at) where receipt_status is null;
alter table public.push_tickets enable row level security;
revoke all on public.push_tickets from anon, authenticated;

-- [{ "ticket_id": "...", "notification_id": 1, "token": "ExponentPushToken[...]" }]
create or replace function public.record_push_tickets(p_tickets jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_tickets (ticket_id, notification_id, token)
  select t ->> 'ticket_id', (t ->> 'notification_id')::bigint, t ->> 'token'
    from jsonb_array_elements(coalesce(p_tickets, '[]'::jsonb)) t
   where t ->> 'ticket_id' is not null
  on conflict (ticket_id) do nothing
$$;

-- Tickets ready for a receipt check (Expo recommends waiting ~15 minutes;
-- receipts are kept for 24 hours). Older unchecked tickets are expired.
create or replace function public.claim_receipt_batch(p_limit int default 1000)
returns table (ticket_id text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_tickets set receipt_status = 'expired', checked_at = now()
   where receipt_status is null and created_at < now() - interval '23 hours';
  return query
  select t.ticket_id from public.push_tickets t
   where t.receipt_status is null and t.created_at < now() - interval '15 minutes'
     and (t.checked_at is null or t.checked_at < now() - interval '10 minutes')
   order by t.created_at
   limit least(greatest(p_limit, 1), 1000);
end;
$$;

-- [{ "ticket_id": "...", "status": "ok" | "error", "error": "DeviceNotRegistered" }]
-- Tickets Expo has no receipt for yet are left unchecked for the next round.
create or replace function public.record_push_receipts(p_receipts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
begin
  with upd as (
    update public.push_tickets t
       set receipt_status = r ->> 'status', receipt_error = left(r ->> 'error', 200), checked_at = now()
      from jsonb_array_elements(coalesce(p_receipts, '[]'::jsonb)) r
     where t.ticket_id = r ->> 'ticket_id' and r ->> 'status' in ('ok', 'error')
    returning t.notification_id, t.token, t.receipt_error
  ), dead as (
    delete from public.push_tokens pt using upd
     where pt.token = upd.token and upd.receipt_error = 'DeviceNotRegistered'
  )
  select array_agg(distinct notification_id) into v_ids from upd;

  -- delivered if any device's receipt is ok; failed once every ticket has an error.
  update public.notifications n
     set push_status = 'delivered', push_error = null
   where n.id = any(coalesce(v_ids, '{}'))
     and exists (select 1 from public.push_tickets t where t.notification_id = n.id and t.receipt_status = 'ok');
  update public.notifications n
     set push_status = 'failed',
         push_error = (select string_agg(distinct t.receipt_error, ', ') from public.push_tickets t where t.notification_id = n.id)
   where n.id = any(coalesce(v_ids, '{}'))
     and n.push_status = 'sent'
     and not exists (select 1 from public.push_tickets t
                      where t.notification_id = n.id and (t.receipt_status is null or t.receipt_status = 'ok'));
end;
$$;

-- Files no longer referenced by anything, at least a day old.
create or replace function public.orphaned_media(p_limit int default 500)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where o.created_at < now() - interval '1 day'
     and (
       (o.bucket_id = 'chat-media'
         and not exists (select 1 from public.messages m where m.attachment_path = o.name and m.deleted_at is null)
         -- keep files attached to reported messages as evidence
         and not exists (select 1 from public.reports r where r.target_type = 'message'
                          and r.snapshot ->> 'attachment_path' = o.name and r.status in ('open', 'reviewing')))
       or (o.bucket_id = 'post-media'
         and not exists (select 1 from public.post_media pm where pm.path = o.name)
         and not exists (select 1 from public.reports r where r.target_type = 'post'
                          and r.snapshot -> 'media' ? o.name and r.status in ('open', 'reviewing')))
       or (o.bucket_id = 'profile-media'
         and not exists (select 1 from public.profiles p where p.avatar_path = o.name or p.cover_path = o.name))
     )
   order by o.created_at
   limit least(greatest(p_limit, 1), 1000)
$$;

create or replace function public.kick_media_cleanup()
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
    using v_url || '/functions/v1/cleanup-media',
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
end;
$$;

-- Old tickets go with the 90-day notification purge (cascade); checked ones sooner.
create or replace function public.purge_push_tickets()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tickets where receipt_status is not null and checked_at < now() - interval '7 days'
$$;

revoke execute on function
  public.record_push_tickets(jsonb), public.claim_receipt_batch(int), public.record_push_receipts(jsonb),
  public.orphaned_media(int), public.kick_media_cleanup(), public.purge_push_tickets()
  from public, anon, authenticated;
grant execute on function
  public.record_push_tickets(jsonb), public.claim_receipt_batch(int), public.record_push_receipts(jsonb),
  public.orphaned_media(int)
  to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('media-cleanup', '30 3 * * *', 'select public.kick_media_cleanup()');
    perform cron.schedule('purge-push-tickets', '15 4 * * *', 'select public.purge_push_tickets()');
  else
    raise notice 'pg_cron not available; schedule public.kick_media_cleanup() daily';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Account deletion erases what the member wrote to others, not just their
-- profile: messages and comments are blanked (the chat keeps a "Message
-- deleted" placeholder so threads stay readable). Posts, reactions, groups
-- memberships and RSVPs cascade. Chat photos are then removed by the
-- cleanup-media job because no live message refers to them.
-- ---------------------------------------------------------------------------
create or replace function public.on_profile_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages set deleted_at = coalesce(deleted_at, now()), body = null, attachment_meta = null
   where sender_id = old.id and kind <> 'system';
  update public.post_comments set deleted_at = coalesce(deleted_at, now()), body = '[deleted]'
   where author_id = old.id;
  return old;
end;
$$;
revoke execute on function public.on_profile_deleted() from public, anon, authenticated;

create trigger profiles_before_delete before delete on public.profiles
  for each row execute function public.on_profile_deleted();
