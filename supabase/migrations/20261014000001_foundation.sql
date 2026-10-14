-- NearMalayali foundation: extensions, shared types and helpers.
--
-- Conventions used by every migration:
--   * Every table in public has RLS enabled.
--   * Supabase grants new tables to anon/authenticated by default, so each
--     table REVOKEs everything first and then GRANTs only what clients need.
--   * Privileged logic lives in SECURITY DEFINER functions with a pinned
--     search_path; EXECUTE is revoked from public/anon and granted explicitly.
--   * Errors meant for the app are raised with a stable UPPER_SNAKE message
--     so the client can map them to friendly text.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.field_visibility as enum ('public', 'connections', 'only_me');
create type public.message_permission as enum ('everyone', 'requests', 'connections_only');
create type public.connect_permission as enum ('everyone', 'nobody');
create type public.account_status as enum ('active', 'deactivated', 'suspended');
create type public.app_role as enum ('admin', 'moderator');

-- Keeps updated_at current on any table that has the column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True when every element is non-empty, at most max_len characters, and the
-- array has at most max_items elements. Used by CHECK constraints.
create or replace function public.text_array_ok(arr text[], max_items int, max_len int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select arr is null or (
    coalesce(array_length(arr, 1), 0) <= max_items
    and not exists (
      select 1 from unnest(arr) as t(v)
      where v is null or length(btrim(v)) = 0 or length(v) > max_len
    )
  )
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
