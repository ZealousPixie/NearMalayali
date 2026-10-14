// Connections and follows. All rules (privacy, blocks, rate limits) are
// enforced by the database functions; these wrappers only call them.
import { supabase } from './supabase';
import type { MessagePermission } from './types';

export interface Relationship {
  connected: boolean;
  following: boolean;
  followed_by: boolean;
  outgoing_request_id: number | null;
  incoming_request_id: number | null;
  accepts_requests: boolean;
  message_permission: MessagePermission;
}

export interface ProfileStats {
  connections: number | null;
  followers: number;
  following: number;
}

export interface SocialPerson {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
}

export interface ConnectionRequest extends SocialPerson {
  request_id: number;
  message: string | null;
  created_at: string;
}

export type RequestResult = 'REQUESTED' | 'ALREADY_REQUESTED' | 'ALREADY_CONNECTED' | 'CONNECTED';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const getRelationship = (userId: string) => rpc<Relationship | null>('get_relationship', { p_user: userId });
export const profileStats = (userId: string) => rpc<ProfileStats | null>('profile_stats', { p_user: userId });

export const sendConnectionRequest = (userId: string, message?: string) =>
  rpc<RequestResult>('send_connection_request', { p_user: userId, p_message: message ?? null });
export const respondConnectionRequest = (requestId: number, accept: boolean) =>
  rpc<void>('respond_connection_request', { p_request_id: requestId, p_accept: accept });
export const cancelConnectionRequest = (requestId: number) =>
  rpc<void>('cancel_connection_request', { p_request_id: requestId });
export const removeConnection = (userId: string) => rpc<void>('remove_connection', { p_user: userId });

export const followUser = (userId: string) => rpc<void>('follow_user', { p_user: userId });
export const unfollowUser = (userId: string) => rpc<void>('unfollow_user', { p_user: userId });
export const removeFollower = (userId: string) => rpc<void>('remove_follower', { p_user: userId });

export async function listConnections(userId: string): Promise<SocialPerson[]> {
  return (await rpc<SocialPerson[] | null>('list_connections', { p_user: userId, p_limit: 100 })) ?? [];
}

export async function mutualConnections(userId: string): Promise<SocialPerson[]> {
  return (await rpc<SocialPerson[] | null>('mutual_connections', { p_user: userId })) ?? [];
}

export async function listConnectionRequests(direction: 'incoming' | 'outgoing'): Promise<ConnectionRequest[]> {
  const rows = (await rpc<(Omit<ConnectionRequest, 'id'> & { user_id: string })[] | null>('list_connection_requests', {
    p_direction: direction,
  })) ?? [];
  return rows.map((r) => ({ ...r, id: r.user_id }));
}

export async function listFollows(direction: 'followers' | 'following'): Promise<SocialPerson[]> {
  const rows = (await rpc<(Omit<SocialPerson, 'id'> & { user_id: string })[] | null>('list_follows', {
    p_direction: direction,
    p_limit: 100,
  })) ?? [];
  return rows.map((r) => ({ ...r, id: r.user_id }));
}

export interface SuggestedPerson extends SocialPerson {
  home_region: string | null;
  mutual_count: number;
  reason: string;
}

export async function suggestedPeople(): Promise<SuggestedPerson[]> {
  return (await rpc<SuggestedPerson[] | null>('suggested_people', { p_limit: 20 })) ?? [];
}
