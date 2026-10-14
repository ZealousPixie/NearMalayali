-- Profiles, per-field visibility, private account data and consent records.
--
-- Split on purpose:
--   profiles            the "card" any signed-in user may see (username,
--                       display name, photo). Readable via RLS.
--   profile_details     fields whose visibility the owner controls. Only the
--                       owner can read the table; everyone else goes through
--                       public.get_profile(), which applies the visibility rules.
--   profile_visibility  the owner's visibility and contact choices.
--   account_private     data nobody else ever sees (date of birth).
--   consents            append-only record of accepted legal documents.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  display_name text not null default '',
  avatar_path text,
  cover_path text,
  is_verified boolean not null default false,
  account_status public.account_status not null default 'active',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format
    check (username is null or username ~ '^[a-z0-9_]{3,24}$'),
  constraint profiles_display_name_length
    check (length(display_name) <= 50),
  constraint profiles_onboarded_has_identity
    check (onboarding_completed_at is null
           or (username is not null and length(btrim(display_name)) > 0)),
  -- Media must live in the owner's own storage folder.
  constraint profiles_avatar_in_own_folder
    check (avatar_path is null or avatar_path like (id::text || '/%')),
  constraint profiles_cover_in_own_folder
    check (cover_path is null or cover_path like (id::text || '/%'))
);

create unique index profiles_username_key on public.profiles (username);
create index profiles_display_name_search on public.profiles (lower(display_name) text_pattern_ops);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.profile_details (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  bio text not null default '',
  languages text[] not null default array['Malayalam', 'English'],
  home_region text not null default '',
  interests text[] not null default '{}',
  occupation text not null default '',
  intro text not null default '',
  connection_preferences text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint details_bio_length check (length(bio) <= 500),
  constraint details_region_length check (length(home_region) <= 80),
  constraint details_occupation_length check (length(occupation) <= 80),
  constraint details_intro_length check (length(intro) <= 300),
  constraint details_languages_ok check (public.text_array_ok(languages, 10, 30)),
  constraint details_interests_ok check (public.text_array_ok(interests, 20, 30)),
  constraint details_connection_prefs_ok check (
    connection_preferences <@ array[
      'friendship', 'networking', 'family_meetups', 'newcomer_help',
      'sports', 'culture', 'professional', 'faith', 'study'
    ]::text[]
  )
);

create trigger profile_details_updated_at before update on public.profile_details
  for each row execute function public.set_updated_at();

create table public.profile_visibility (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  bio public.field_visibility not null default 'public',
  languages public.field_visibility not null default 'public',
  home_region public.field_visibility not null default 'public',
  interests public.field_visibility not null default 'public',
  occupation public.field_visibility not null default 'connections',
  intro public.field_visibility not null default 'public',
  connection_preferences public.field_visibility not null default 'public',
  connections_list public.field_visibility not null default 'connections',
  group_memberships public.field_visibility not null default 'public',
  -- Whether the profile appears in people search by name/username.
  searchable boolean not null default true,
  who_can_message public.message_permission not null default 'requests',
  who_can_connect public.connect_permission not null default 'everyone',
  show_online_status boolean not null default false,
  read_receipts boolean not null default true,
  typing_indicators boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger profile_visibility_updated_at before update on public.profile_visibility
  for each row execute function public.set_updated_at();

create table public.account_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  date_of_birth date,
  created_at timestamptz not null default now()
);

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy', 'community_guidelines', 'location')),
  version text not null check (length(version) between 1 and 20),
  accepted_at timestamptz not null default now()
);

create index consents_user_idx on public.consents (user_id, document);

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profile_details enable row level security;
alter table public.profile_visibility enable row level security;
alter table public.account_private enable row level security;
alter table public.consents enable row level security;

revoke all on public.profiles, public.profile_details, public.profile_visibility,
  public.account_private, public.consents from anon, authenticated;

grant select on public.profiles to authenticated;
-- username changes go through set_username(); status/verification are admin-only.
grant update (display_name, avatar_path, cover_path) on public.profiles to authenticated;

grant select on public.profile_details to authenticated;
grant update (bio, languages, home_region, interests, occupation, intro, connection_preferences)
  on public.profile_details to authenticated;

grant select on public.profile_visibility to authenticated;
grant update (bio, languages, home_region, interests, occupation, intro, connection_preferences,
  connections_list, group_memberships, searchable, who_can_message, who_can_connect,
  show_online_status, read_receipts, typing_indicators)
  on public.profile_visibility to authenticated;

grant select on public.account_private to authenticated;
grant select on public.consents to authenticated;

create policy "own details readable" on public.profile_details
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own details editable" on public.profile_details
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own visibility readable" on public.profile_visibility
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own visibility editable" on public.profile_visibility
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own private data readable" on public.account_private
  for select to authenticated using (user_id = (select auth.uid()));

create policy "own consents readable" on public.consents
  for select to authenticated using (user_id = (select auth.uid()));

create policy "own profile editable" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- The SELECT policy for profiles needs the block helpers, so it is created in
-- the safety migration.
