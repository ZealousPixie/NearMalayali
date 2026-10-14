// Groups, posts, events and the noticeboard. Visibility, membership and
// blocking rules are all enforced by the database functions.
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// ---- Posts ------------------------------------------------------------------
export type PostVisibility = 'public' | 'connections' | 'group';

export interface PostMedia {
  path: string;
  width: number | null;
  height: number | null;
}

export interface Post {
  id: string;
  author_id: string;
  author_username: string;
  author_name: string;
  author_avatar: string | null;
  author_verified: boolean;
  visibility: PostVisibility;
  group_id: string | null;
  group_name: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  media: PostMedia[];
  reaction_count: number;
  comment_count: number;
  my_reaction: string | null;
  bookmarked: boolean;
  shared:
    | null
    | { unavailable: true }
    | { id: string; body: string; author_name: string; author_username: string; created_at: string; media: PostMedia[] };
}

export interface PostCursor {
  before: string;
  beforeId: string;
}

export function nextCursor(posts: Post[]): PostCursor | null {
  const last = posts[posts.length - 1];
  return last ? { before: last.created_at, beforeId: last.id } : null;
}

export async function homeFeed(cursor?: PostCursor | null): Promise<Post[]> {
  return (
    (await rpc<Post[] | null>('home_feed', {
      p_before: cursor?.before ?? null,
      p_before_id: cursor?.beforeId ?? null,
      p_limit: 20,
    })) ?? []
  );
}

export async function listPosts(scope: 'user' | 'group' | 'bookmarks', target?: string | null, cursor?: PostCursor | null): Promise<Post[]> {
  return (
    (await rpc<Post[] | null>('list_posts', {
      p_scope: scope,
      p_target: target ?? null,
      p_before: cursor?.before ?? null,
      p_before_id: cursor?.beforeId ?? null,
      p_limit: 20,
    })) ?? []
  );
}

export const getPost = (id: string) => rpc<Post | null>('get_post', { p_post: id });

export async function pickPostPhotos(max: number): Promise<string[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('PHOTO_PERMISSION_DENIED');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: max,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, max).map((a) => a.uri);
}

/** Re-encodes (stripping location metadata) and uploads to my private folder. */
async function uploadPostPhoto(userId: string, uri: string): Promise<{ path: string; width: number; height: number }> {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  context.resize({ width: 1600 });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  const body = await fetch(saved.uri).then((r) => r.arrayBuffer());
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const { error } = await supabase.storage.from('post-media').upload(path, body, { contentType: 'image/jpeg' });
  if (error) throw error;
  return { path, width: saved.width, height: saved.height };
}

export async function createPost(args: {
  userId: string;
  body: string;
  visibility: PostVisibility;
  groupId?: string | null;
  photos?: string[];
  sharedPostId?: string | null;
}): Promise<string> {
  const uploaded: { path: string; width: number; height: number }[] = [];
  try {
    for (const uri of args.photos ?? []) uploaded.push(await uploadPostPhoto(args.userId, uri));
    return await rpc<string>('create_post', {
      p_body: args.body,
      p_visibility: args.visibility,
      p_group: args.groupId ?? null,
      p_media: uploaded,
      p_shared_post: args.sharedPostId ?? null,
    });
  } catch (e) {
    if (uploaded.length) await supabase.storage.from('post-media').remove(uploaded.map((u) => u.path));
    throw e;
  }
}

export const editPost = (id: string, body: string) => rpc<void>('edit_post', { p_post: id, p_body: body });

export async function deletePost(id: string): Promise<void> {
  const paths = await rpc<string[] | null>('delete_post', { p_post: id });
  if (paths?.length) await supabase.storage.from('post-media').remove(paths);
}

export const reactToPost = (id: string, emoji: string | null) => rpc<void>('react_to_post', { p_post: id, p_emoji: emoji });

export async function setBookmark(userId: string, postId: string, on: boolean): Promise<void> {
  const { error } = on
    ? await supabase.from('bookmarks').insert({ user_id: userId, post_id: postId })
    : await supabase.from('bookmarks').delete().eq('user_id', userId).eq('post_id', postId);
  if (error && (error as { code?: string }).code !== '23505') throw error;
}

export interface Comment {
  id: number;
  parent_id: number | null;
  author_id: string | null;
  author_name: string;
  author_username: string | null;
  author_avatar: string | null;
  body: string;
  created_at: string;
  deleted: boolean;
}

export async function listComments(postId: string): Promise<Comment[]> {
  return (await rpc<Comment[] | null>('list_comments', { p_post: postId })) ?? [];
}
export const commentOnPost = (postId: string, body: string, parentId?: number | null) =>
  rpc<number>('comment_on_post', { p_post: postId, p_body: body, p_parent: parentId ?? null });
export const deleteComment = (id: number) => rpc<void>('delete_comment', { p_comment: id });

const signed = new Map<string, { url: string; expires: number }>();
export async function postMediaUrl(path: string): Promise<string> {
  const cached = signed.get(path);
  if (cached && cached.expires > Date.now() + 60_000) return cached.url;
  const { data, error } = await supabase.storage.from('post-media').createSignedUrl(path, 3600);
  if (error) throw error;
  signed.set(path, { url: data.signedUrl, expires: Date.now() + 3600_000 });
  return data.signedUrl;
}

// ---- Groups -----------------------------------------------------------------
export type GroupPrivacy = 'public' | 'approval' | 'private';
export type GroupRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  privacy: GroupPrivacy;
  region: string;
  member_count: number;
  my_status: 'active' | 'requested' | 'invited' | null;
  my_role: GroupRole | null;
}

export interface GroupDetails extends Omit<GroupSummary, 'member_count'> {
  created_at: string;
  conversation_id: string | null;
  member_count: number;
  pending_requests: number | null;
}

export interface GroupMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  role: GroupRole;
  joined_at: string;
}

export async function listGroups(scope: 'discover' | 'mine', query?: string): Promise<GroupSummary[]> {
  return (await rpc<GroupSummary[] | null>('list_groups', { p_scope: scope, p_query: query ?? null, p_limit: 50 })) ?? [];
}
export const groupDetails = (id: string) => rpc<GroupDetails | null>('group_details', { p_group: id });
export async function listGroupMembers(id: string, status: 'active' | 'requested' = 'active'): Promise<GroupMember[]> {
  return (await rpc<GroupMember[] | null>('list_group_members', { p_group: id, p_status: status })) ?? [];
}
export const createGroup = (name: string, description: string, privacy: GroupPrivacy, region: string) =>
  rpc<string>('create_group', { p_name: name, p_description: description, p_privacy: privacy, p_region: region });
export const updateGroup = (id: string, name: string, description: string, privacy: GroupPrivacy, region: string) =>
  rpc<void>('update_group', { p_group: id, p_name: name, p_description: description, p_privacy: privacy, p_region: region });
export const joinGroup = (id: string) => rpc<'JOINED' | 'REQUESTED' | 'ALREADY_MEMBER'>('join_group', { p_group: id });
export const leaveGroup = (id: string) => rpc<void>('leave_group', { p_group: id });
export const declineGroupInvite = (id: string) => rpc<void>('decline_group_invite', { p_group: id });
export const respondJoinRequest = (id: string, userId: string, accept: boolean) =>
  rpc<void>('respond_join_request', { p_group: id, p_user: userId, p_accept: accept });
export const inviteToGroup = (id: string, userId: string) => rpc<void>('invite_to_group', { p_group: id, p_user: userId });
export const removeGroupMember = (id: string, userId: string, ban = false) =>
  rpc<void>('remove_group_member', { p_group: id, p_user: userId, p_ban: ban });
export const setGroupRole = (id: string, userId: string, role: Exclude<GroupRole, 'owner'>) =>
  rpc<void>('set_group_role', { p_group: id, p_user: userId, p_role: role });

// ---- Events -----------------------------------------------------------------
export type EventVisibility = 'public' | 'connections' | 'group' | 'invite_only';
export type RsvpStatus = 'going' | 'interested' | 'not_going' | 'invited';

export interface EventSummary {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  venue_name: string;
  region: string;
  host_name: string;
  group_name: string | null;
  going_count: number;
  my_status: RsvpStatus | null;
  cancelled: boolean;
  is_host: boolean;
}

export interface EventDetails {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  venue_name: string;
  region: string;
  visibility: EventVisibility;
  capacity: number | null;
  cancelled_at: string | null;
  group_id: string | null;
  group_name: string | null;
  host_id: string;
  host_name: string;
  host_username: string;
  host_avatar: string | null;
  is_host: boolean;
  my_status: RsvpStatus | null;
  my_hidden: boolean | null;
  address_visibility: 'everyone' | 'attendees';
  address: string | null;
  online_url: string | null;
  has_online_link: boolean;
  going_count: number;
  interested_count: number;
}

export interface EventInput {
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  venueName: string;
  address: string;
  addressVisibility: 'everyone' | 'attendees';
  region: string;
  onlineUrl: string;
  visibility: EventVisibility;
  groupId?: string | null;
  capacity: number | null;
}

export async function listEvents(scope: 'upcoming' | 'mine' | 'group', opts: { region?: string; groupId?: string } = {}): Promise<EventSummary[]> {
  return (
    (await rpc<EventSummary[] | null>('list_events', {
      p_scope: scope,
      p_region: opts.region ?? null,
      p_group: opts.groupId ?? null,
      p_limit: 50,
    })) ?? []
  );
}
export const eventDetails = (id: string) => rpc<EventDetails | null>('event_details', { p_event: id });
export async function eventAttendees(id: string) {
  return (
    (await rpc<{ user_id: string; username: string; display_name: string; avatar_path: string | null; status: RsvpStatus }[] | null>(
      'event_attendees',
      { p_event: id },
    )) ?? []
  );
}
export const createEvent = (e: EventInput) =>
  rpc<string>('create_event', {
    p_title: e.title,
    p_description: e.description,
    p_starts_at: e.startsAt.toISOString(),
    p_ends_at: e.endsAt?.toISOString() ?? null,
    p_venue_name: e.venueName,
    p_address: e.address,
    p_address_visibility: e.addressVisibility,
    p_region: e.region,
    p_online_url: e.onlineUrl.trim() || null,
    p_visibility: e.visibility,
    p_group: e.groupId ?? null,
    p_capacity: e.capacity,
  });
export const updateEvent = (id: string, e: EventInput) =>
  rpc<void>('update_event', {
    p_event: id,
    p_title: e.title,
    p_description: e.description,
    p_starts_at: e.startsAt.toISOString(),
    p_ends_at: e.endsAt?.toISOString() ?? null,
    p_venue_name: e.venueName,
    p_address: e.address,
    p_address_visibility: e.addressVisibility,
    p_region: e.region,
    p_online_url: e.onlineUrl.trim() || null,
    p_capacity: e.capacity,
  });
export const cancelEvent = (id: string) => rpc<void>('cancel_event', { p_event: id });
export const rsvpEvent = (id: string, status: Exclude<RsvpStatus, 'invited'>, hide: boolean) =>
  rpc<void>('rsvp_event', { p_event: id, p_status: status, p_hide_from_list: hide });
export const inviteToEvent = (id: string, userId: string) => rpc<void>('invite_to_event', { p_event: id, p_user: userId });

// ---- Noticeboard --------------------------------------------------------------
export const NOTICE_CATEGORIES = [
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'jobs', label: 'Jobs' },
  { value: 'for_sale', label: 'For sale' },
  { value: 'rides', label: 'Rides' },
  { value: 'services', label: 'Services' },
  { value: 'lost_found', label: 'Lost & found' },
  { value: 'announcements', label: 'Announcements' },
  { value: 'help_wanted', label: 'Help wanted' },
] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number]['value'];

export interface Notice {
  id: string;
  category: NoticeCategory;
  title: string;
  body: string;
  region: string;
  created_at: string;
  expires_at: string;
  author_id: string;
  author_name: string;
  author_username: string;
  is_mine: boolean;
}

export async function listNotices(opts: { category?: NoticeCategory | null; region?: string; query?: string }): Promise<Notice[]> {
  return (
    (await rpc<Notice[] | null>('list_notices', {
      p_category: opts.category ?? null,
      p_region: opts.region ?? null,
      p_query: opts.query ?? null,
      p_limit: 50,
    })) ?? []
  );
}
export const createNotice = (category: NoticeCategory, title: string, body: string, region: string, days: number) =>
  rpc<string>('create_notice', { p_category: category, p_title: title, p_body: body, p_region: region, p_days: days });
export const deleteNotice = (id: string) => rpc<void>('delete_notice', { p_notice: id });
