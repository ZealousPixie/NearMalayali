-- Account lifecycle: rows created at sign-up, onboarding with age check and
-- consent, username changes, profile viewing with field visibility,
-- deactivation and reactivation. Permanent deletion is done by the
-- delete-account Edge Function (it needs the service role to remove the
-- auth user; every table cascades from auth.users).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.profile_details (user_id) values (new.id);
  insert into public.profile_visibility (user_id) values (new.id);
  insert into public.account_private (user_id) values (new.id);
  insert into public.discovery_settings (user_id) values (new.id);
  insert into public.notification_preferences (user_id) values (new.id);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Reserved names that could be used to impersonate staff.
create or replace function public.is_reserved_username(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p = any (array[
    'admin', 'administrator', 'support', 'help', 'moderator', 'mod', 'staff',
    'official', 'nearmalayali', 'near_malayali', 'root', 'system', 'security',
    'team', 'everyone', 'null', 'undefined'
  ])
$$;

create or replace function public.normalize_username(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p, '')))
$$;

create or replace function public.validate_username(p text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := public.normalize_username(p);
begin
  if v !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'USERNAME_INVALID' using errcode = '22023';
  end if;
  if public.is_reserved_username(v) then
    raise exception 'USERNAME_RESERVED' using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function public.username_available(p_username text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := public.normalize_username(p_username);
begin
  perform public.check_rate_limit('username_check', 60, 60);
  if v !~ '^[a-z0-9_]{3,24}$' or public.is_reserved_username(v) then
    return false;
  end if;
  return not exists (
    select 1 from public.profiles where username = v and id <> auth.uid()
  );
end;
$$;

create or replace function public.complete_onboarding(
  p_username text,
  p_display_name text,
  p_date_of_birth date,
  p_terms_version text,
  p_privacy_version text,
  p_guidelines_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_display text := btrim(coalesce(p_display_name, ''));
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  perform public.check_rate_limit('complete_onboarding', 10, 3600);

  if exists (select 1 from public.profiles where id = v_uid and onboarding_completed_at is not null) then
    raise exception 'ALREADY_ONBOARDED' using errcode = '22023';
  end if;

  if p_date_of_birth is null
     or p_date_of_birth > current_date
     or p_date_of_birth < date '1900-01-01' then
    raise exception 'DOB_INVALID' using errcode = '22023';
  end if;
  if p_date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'AGE_INELIGIBLE' using errcode = '22023';
  end if;

  if length(v_display) < 1 or length(v_display) > 50 then
    raise exception 'DISPLAY_NAME_INVALID' using errcode = '22023';
  end if;

  if coalesce(p_terms_version, '') = '' or coalesce(p_privacy_version, '') = ''
     or coalesce(p_guidelines_version, '') = '' then
    raise exception 'CONSENT_REQUIRED' using errcode = '22023';
  end if;

  v_username := public.validate_username(p_username);
  if exists (select 1 from public.profiles where username = v_username and id <> v_uid) then
    raise exception 'USERNAME_TAKEN' using errcode = '23505';
  end if;

  update public.account_private set date_of_birth = p_date_of_birth where user_id = v_uid;

  insert into public.consents (user_id, document, version) values
    (v_uid, 'terms', p_terms_version),
    (v_uid, 'privacy', p_privacy_version),
    (v_uid, 'community_guidelines', p_guidelines_version);

  begin
    update public.profiles
      set username = v_username,
          display_name = v_display,
          onboarding_completed_at = now()
      where id = v_uid;
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN' using errcode = '23505';
  end;
end;
$$;

-- Username changes are rate limited to slow down impersonation churn.
create or replace function public.set_username(p_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  v_username := public.validate_username(p_username);
  if exists (select 1 from public.profiles where id = v_uid and username = v_username) then
    return;
  end if;
  perform public.check_rate_limit('set_username', 3, 30 * 86400);
  begin
    update public.profiles set username = v_username where id = v_uid;
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN' using errcode = '23505';
  end;
end;
$$;

-- Records consent to an updated document (e.g. location terms in Stage B).
create or replace function public.record_consent(p_document text, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  perform public.check_rate_limit('record_consent', 20, 3600);
  insert into public.consents (user_id, document, version)
  values (auth.uid(), p_document, p_version);
end;
$$;

-- Returns a profile as the caller is allowed to see it, or NULL when the
-- caller may not see it at all (blocked, inactive, not onboarded).
create or replace function public.get_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  p public.profiles;
  d public.profile_details;
  v public.profile_visibility;
  v_self boolean;
  v_connected boolean;
  result jsonb;
begin
  if v_viewer is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;

  select * into p from public.profiles where id = p_user_id;
  if not found then
    return null;
  end if;
  v_self := p_user_id = v_viewer;
  if not v_self and (
       p.account_status <> 'active'
       or p.onboarding_completed_at is null
       or public.is_blocked_between(p_user_id, v_viewer)) then
    return null;
  end if;

  select * into d from public.profile_details where user_id = p_user_id;
  select * into v from public.profile_visibility where user_id = p_user_id;
  v_connected := not v_self and public.are_connected(p_user_id, v_viewer);

  result := jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_path', p.avatar_path,
    'cover_path', p.cover_path,
    'is_verified', p.is_verified,
    'member_since', to_char(p.created_at, 'YYYY-MM'),
    'is_self', v_self,
    'is_connected', v_connected
  );

  if public.can_view_field(p_user_id, v_viewer, v.bio) then
    result := result || jsonb_build_object('bio', d.bio);
  end if;
  if public.can_view_field(p_user_id, v_viewer, v.languages) then
    result := result || jsonb_build_object('languages', to_jsonb(d.languages));
  end if;
  if public.can_view_field(p_user_id, v_viewer, v.home_region) then
    result := result || jsonb_build_object('home_region', d.home_region);
  end if;
  if public.can_view_field(p_user_id, v_viewer, v.interests) then
    result := result || jsonb_build_object('interests', to_jsonb(d.interests));
  end if;
  if public.can_view_field(p_user_id, v_viewer, v.occupation) then
    result := result || jsonb_build_object('occupation', d.occupation);
  end if;
  if public.can_view_field(p_user_id, v_viewer, v.intro) then
    result := result || jsonb_build_object('intro', d.intro);
  end if;
  if public.can_view_field(p_user_id, v_viewer, v.connection_preferences) then
    result := result || jsonb_build_object('connection_preferences', to_jsonb(d.connection_preferences));
  end if;

  return result;
end;
$$;

create or replace function public.deactivate_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  update public.profiles set account_status = 'deactivated'
    where id = auth.uid() and account_status = 'active';
end;
$$;

-- Suspended accounts cannot reactivate themselves.
create or replace function public.reactivate_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and account_status = 'suspended') then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = 'PT403';
  end if;
  update public.profiles set account_status = 'active'
    where id = auth.uid() and account_status = 'deactivated';
end;
$$;

revoke execute on function
  public.is_reserved_username(text), public.normalize_username(text), public.validate_username(text),
  public.username_available(text),
  public.complete_onboarding(text, text, date, text, text, text),
  public.set_username(text), public.record_consent(text, text),
  public.get_profile(uuid), public.deactivate_account(), public.reactivate_account()
  from public, anon;

grant execute on function
  public.username_available(text),
  public.complete_onboarding(text, text, date, text, text, text),
  public.set_username(text), public.record_consent(text, text),
  public.get_profile(uuid), public.deactivate_account(), public.reactivate_account()
  to authenticated;

revoke execute on function public.validate_username(text) from authenticated;

-- Blocked people as the blocker sees them (their profiles are otherwise
-- hidden from the blocker by the profiles policy).
create or replace function public.list_blocked_users()
returns table (id uuid, username text, display_name text, avatar_path text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_path, b.created_at
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc
$$;

-- People search by username or display name. Respects the "searchable"
-- choice, blocks and account status. Never returns location data.
create or replace function public.search_people(p_query text, p_limit int default 20, p_offset int default 0)
returns table (id uuid, username text, display_name text, avatar_path text, is_verified boolean, home_region text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_pattern text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if length(v_q) < 2 then
    return;
  end if;
  v_q := ltrim(v_q, '@');
  -- Escape LIKE wildcards typed by the user.
  v_pattern := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select p.id, p.username, p.display_name, p.avatar_path, p.is_verified,
         case when vis.home_region = 'public' then d.home_region else null end
  from public.profiles p
  join public.profile_visibility vis on vis.user_id = p.id
  join public.profile_details d on d.user_id = p.id
  where p.id <> v_uid
    and p.account_status = 'active'
    and p.onboarding_completed_at is not null
    and vis.searchable
    and not public.is_blocked_between(p.id, v_uid)
    and (p.username like v_pattern or lower(p.display_name) like v_pattern
         or lower(p.display_name) like '% ' || v_pattern)
  order by (p.username = v_q) desc, (p.username like v_pattern) desc, p.display_name
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.list_blocked_users(), public.search_people(text, int, int) from public, anon;
grant execute on function public.list_blocked_users(), public.search_people(text, int, int) to authenticated;
