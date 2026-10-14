// Thin, typed wrappers around Supabase calls. Each throws on error so screens
// can show friendlyError(e); none of them fake success.
import { supabase } from './supabase';
import type {
  DiscoverySettings,
  NotificationPreferences,
  PersonSummary,
  Profile,
  ProfileDetails,
  ProfileVisibility,
  PublicProfile,
} from './types';

function must<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  if (result.data === null) throw new Error('Not found');
  return result.data;
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('NOT_AUTHENTICATED');
  return id;
}

// ---- Own account ----------------------------------------------------------
export async function fetchOwnProfile(userId: string): Promise<Profile> {
  return must(await supabase.from('profiles').select('*').eq('id', userId).single());
}

export async function fetchOwnDetails(): Promise<ProfileDetails> {
  const id = await currentUserId();
  return must(await supabase.from('profile_details').select('*').eq('user_id', id).single());
}

export async function updateOwnDetails(patch: Partial<Omit<ProfileDetails, 'user_id'>>): Promise<void> {
  const id = await currentUserId();
  const { error } = await supabase.from('profile_details').update(patch).eq('user_id', id);
  if (error) throw error;
}

export async function updateOwnProfile(
  patch: Partial<Pick<Profile, 'display_name' | 'avatar_path' | 'cover_path'>>,
): Promise<void> {
  const id = await currentUserId();
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) throw error;
}

export async function fetchVisibility(): Promise<ProfileVisibility> {
  const id = await currentUserId();
  return must(await supabase.from('profile_visibility').select('*').eq('user_id', id).single());
}

export async function updateVisibility(patch: Partial<Omit<ProfileVisibility, 'user_id'>>): Promise<void> {
  const id = await currentUserId();
  const { error } = await supabase.from('profile_visibility').update(patch).eq('user_id', id);
  if (error) throw error;
}

export async function fetchDiscoverySettings(): Promise<DiscoverySettings> {
  const id = await currentUserId();
  return must(await supabase.from('discovery_settings').select('*').eq('user_id', id).single());
}

export async function updateDiscoverySettings(
  patch: Partial<Omit<DiscoverySettings, 'user_id'>>,
): Promise<DiscoverySettings> {
  const id = await currentUserId();
  return must(
    await supabase.from('discovery_settings').update(patch).eq('user_id', id).select('*').single(),
  );
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const id = await currentUserId();
  return must(await supabase.from('notification_preferences').select('*').eq('user_id', id).single());
}

export async function updateNotificationPreferences(
  patch: Partial<Omit<NotificationPreferences, 'user_id'>>,
): Promise<void> {
  const id = await currentUserId();
  const { error } = await supabase.from('notification_preferences').update(patch).eq('user_id', id);
  if (error) throw error;
}

// ---- Onboarding & identity --------------------------------------------------
export async function usernameAvailable(username: string): Promise<boolean> {
  return must(await supabase.rpc('username_available', { p_username: username })) as boolean;
}

export async function completeOnboarding(args: {
  username: string;
  displayName: string;
  dateOfBirth: string;
  termsVersion: string;
  privacyVersion: string;
  guidelinesVersion: string;
}): Promise<void> {
  const { error } = await supabase.rpc('complete_onboarding', {
    p_username: args.username,
    p_display_name: args.displayName,
    p_date_of_birth: args.dateOfBirth,
    p_terms_version: args.termsVersion,
    p_privacy_version: args.privacyVersion,
    p_guidelines_version: args.guidelinesVersion,
  });
  if (error) throw error;
}

export async function setUsername(username: string): Promise<void> {
  const { error } = await supabase.rpc('set_username', { p_username: username });
  if (error) throw error;
}

// ---- Other people -----------------------------------------------------------
export async function getProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc('get_profile', { p_user_id: userId });
  if (error) throw error;
  return (data as PublicProfile | null) ?? null;
}

export async function searchPeople(query: string, offset = 0, limit = 20): Promise<PersonSummary[]> {
  const { data, error } = await supabase.rpc('search_people', {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as PersonSummary[];
}

export async function blockUser(userId: string): Promise<void> {
  const me = await currentUserId();
  const { error } = await supabase.from('blocks').insert({ blocker_id: me, blocked_id: userId });
  // Already blocked counts as success.
  if (error && (error as { code?: string }).code !== '23505') throw error;
}

export async function unblockUser(userId: string): Promise<void> {
  const me = await currentUserId();
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', userId);
  if (error) throw error;
}

export async function listBlockedUsers(): Promise<(PersonSummary & { blocked_at: string })[]> {
  const { data, error } = await supabase.rpc('list_blocked_users');
  if (error) throw error;
  return (data ?? []) as (PersonSummary & { blocked_at: string })[];
}

// ---- Account lifecycle --------------------------------------------------------
export async function deactivateAccount(): Promise<void> {
  const { error } = await supabase.rpc('deactivate_account');
  if (error) throw error;
}

export async function reactivateAccount(): Promise<void> {
  const { error } = await supabase.rpc('reactivate_account');
  if (error) throw error;
}

/** Permanently deletes the account through the delete-account Edge Function. */
export async function deleteAccountPermanently(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: { confirm: 'DELETE' },
  });
  if (error) throw error;
  if (!(data as { deleted?: boolean } | null)?.deleted) throw new Error('DELETE_FAILED');
}

/** Confirms the current password by signing in again (also refreshes the session). */
export async function verifyPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
