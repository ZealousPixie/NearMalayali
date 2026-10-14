// Messaging. Messages are encrypted in transit and at rest by Supabase, but
// they are NOT end-to-end encrypted; the app says so in the chat screen.
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

export const CHAT_BUCKET = 'chat-media';
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ConversationSummary {
  conversation_id: string;
  kind: 'direct' | 'group';
  title: string | null;
  other_user_id: string | null;
  other_username: string | null;
  avatar_path: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  muted: boolean;
  my_status: 'active' | 'request';
}

export interface ChatMember {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_path: string | null;
  role: 'member' | 'admin';
  status: 'active' | 'request';
}

export interface ConversationDetails {
  id: string;
  kind: 'direct' | 'group';
  title: string | null;
  group_id: string | null;
  my_role: 'member' | 'admin';
  my_status: 'active' | 'request';
  muted_until: string | null;
  members: ChatMember[];
}

export interface ChatMessage {
  id: number;
  conversation_id: string;
  sender_id: string | null;
  kind: 'text' | 'image' | 'video' | 'system';
  body: string | null;
  reply_to_id: number | null;
  attachment_path: string | null;
  attachment_meta: { width?: number; height?: number } | null;
  created_at: string;
  deleted_at: string | null;
}

export interface MessageReaction {
  message_id: number;
  user_id: string;
  emoji: Reaction;
}

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, kind, body, reply_to_id, attachment_path, attachment_meta, created_at, deleted_at';
export const PAGE_SIZE = 40;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export async function listConversations(status: 'active' | 'requests' = 'active'): Promise<ConversationSummary[]> {
  return (await rpc<ConversationSummary[] | null>('list_conversations', { p_status: status })) ?? [];
}

export const unreadMessageCount = () => rpc<number>('unread_message_count');
export const startDirectConversation = (userId: string) => rpc<string>('start_direct_conversation', { p_user: userId });
export const createGroupConversation = (title: string, members: string[]) =>
  rpc<string>('create_group_conversation', { p_title: title, p_members: members });
export const conversationDetails = (id: string) => rpc<ConversationDetails | null>('conversation_details', { p_conversation: id });

/** Newest first. Pass the smallest id you have to load older messages. */
export async function fetchMessages(conversationId: string, beforeId?: number): Promise<ChatMessage[]> {
  let q = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (beforeId) q = q.lt('id', beforeId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export async function fetchMessage(id: number): Promise<ChatMessage | null> {
  const { data, error } = await supabase.from('messages').select(MESSAGE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as ChatMessage | null) ?? null;
}

export async function fetchReactions(messageIds: number[]): Promise<MessageReaction[]> {
  if (!messageIds.length) return [];
  const { data, error } = await supabase
    .from('message_reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', messageIds);
  if (error) throw error;
  return (data ?? []) as MessageReaction[];
}

export const sendTextMessage = (conversationId: string, body: string, replyTo?: number | null) =>
  rpc<number>('send_message', { p_conversation: conversationId, p_body: body, p_kind: 'text', p_reply_to: replyTo ?? null });

export async function deleteMessage(id: number): Promise<void> {
  const path = await rpc<string | null>('delete_message', { p_message_id: id });
  // The message is already gone for everyone; removing the file is best effort
  // (only the uploader may delete it, which is the sender).
  if (path) await supabase.storage.from(CHAT_BUCKET).remove([path]);
}

export const reactToMessage = (id: number, emoji: Reaction | null) =>
  rpc<void>('react_to_message', { p_message_id: id, p_emoji: emoji });
export const markConversationRead = (conversationId: string, messageId: number) =>
  rpc<void>('mark_conversation_read', { p_conversation: conversationId, p_message_id: messageId });
export const respondMessageRequest = (conversationId: string, accept: boolean) =>
  rpc<void>('respond_message_request', { p_conversation: conversationId, p_accept: accept });
export const muteConversation = (conversationId: string, until: Date | null) =>
  rpc<void>('mute_conversation', { p_conversation: conversationId, p_until: until?.toISOString() ?? null });
export const leaveConversation = (conversationId: string) => rpc<void>('leave_conversation', { p_conversation: conversationId });
export const addConversationMembers = (conversationId: string, users: string[]) =>
  rpc<number>('add_conversation_members', { p_conversation: conversationId, p_users: users });
export const removeConversationMember = (conversationId: string, userId: string) =>
  rpc<void>('remove_conversation_member', { p_conversation: conversationId, p_user: userId });
export const setConversationAdmin = (conversationId: string, userId: string, admin: boolean) =>
  rpc<void>('set_conversation_admin', { p_conversation: conversationId, p_user: userId, p_admin: admin });
export const renameConversation = (conversationId: string, title: string) =>
  rpc<void>('rename_conversation', { p_conversation: conversationId, p_title: title });

export async function conversationReadState(conversationId: string): Promise<{ user_id: string; last_read_message_id: number | null }[]> {
  return (await rpc<{ user_id: string; last_read_message_id: number | null }[] | null>('conversation_read_state', {
    p_conversation: conversationId,
  })) ?? [];
}

export async function searchMessages(query: string) {
  return (
    (await rpc<{ message_id: number; conversation_id: string; body: string; created_at: string; sender_name: string | null }[] | null>(
      'search_messages',
      { p_query: query },
    )) ?? []
  );
}

/** Picks a photo, strips metadata by re-encoding, uploads it privately and sends it. */
export async function pickAndSendPhoto(conversationId: string, replyTo?: number | null): Promise<boolean> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('PHOTO_PERMISSION_DENIED');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets?.[0]) return false;

  const context = ImageManipulator.ImageManipulator.manipulate(result.assets[0].uri);
  context.resize({ width: 1600 });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  const body = await fetch(saved.uri).then((r) => r.arrayBuffer());

  const path = `${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, body, { contentType: 'image/jpeg' });
  if (error) throw error;
  try {
    await rpc<number>('send_message', {
      p_conversation: conversationId,
      p_kind: 'image',
      p_attachment_path: path,
      p_attachment_meta: { width: saved.width, height: saved.height },
      p_reply_to: replyTo ?? null,
    });
  } catch (e) {
    await supabase.storage.from(CHAT_BUCKET).remove([path]);
    throw e;
  }
  return true;
}

const signedCache = new Map<string, { url: string; expires: number }>();

/** Short-lived link to a private chat photo. Only members can create one. */
export async function signedMediaUrl(path: string): Promise<string> {
  const cached = signedCache.get(path);
  if (cached && cached.expires > Date.now() + 60_000) return cached.url;
  const { data, error } = await supabase.storage.from(CHAT_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + 3600_000 });
  return data.signedUrl;
}

/** Live updates for one conversation: new messages, unsends and reactions. */
export function subscribeToConversation(
  conversationId: string,
  handlers: { onMessage: (m: ChatMessage) => void; onReactionChange: () => void },
): () => void {
  const channel = supabase
    .channel(`conversation:${conversationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        if (payload.new && 'id' in payload.new) handlers.onMessage(payload.new as ChatMessage);
      },
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => handlers.onReactionChange())
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Fires when anything in my inbox changes (new messages in any of my chats). */
export function subscribeToInbox(onChange: () => void): () => void {
  const channel = supabase
    .channel('inbox')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, () => onChange())
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
