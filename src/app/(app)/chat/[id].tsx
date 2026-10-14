// One conversation: live messages, photos, replies, reactions, unsend,
// message requests and read receipts (when both people allow them).
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Banner, Button, ErrorView, LoadingView, OfflineBanner } from '@/components/ui';
import { FontSize, Radius, Spacing, useTheme } from '@/constants/theme';
import { blockUser } from '@/lib/api';
import {
  type ChatMessage,
  type ConversationDetails,
  conversationDetails,
  conversationReadState,
  deleteMessage,
  fetchMessage,
  fetchMessages,
  fetchReactions,
  markConversationRead,
  type MessageReaction,
  PAGE_SIZE,
  pickAndSendPhoto,
  REACTIONS,
  type Reaction,
  reactToMessage,
  respondMessageRequest,
  sendTextMessage,
  signedMediaUrl,
  subscribeToConversation,
} from '@/lib/chat';
import { friendlyError } from '@/lib/errors';
import { clockTime } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session?.user.id;
  const c = useTheme();

  const [details, setDetails] = useState<ConversationDetails | null | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [readUpTo, setReadUpTo] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const loadingOlder = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refreshReactions = useCallback(async () => {
    const ids = messagesRef.current.map((m) => m.id);
    try {
      setReactions(await fetchReactions(ids));
    } catch {
      // Reactions are decorative; a failed refresh keeps the old ones.
    }
  }, []);

  const loadInitial = useCallback(async () => {
    try {
      const [d, page] = await Promise.all([conversationDetails(id), fetchMessages(id)]);
      setLoadError(null);
      setDetails(d);
      setMessages((prev) => mergeMessages(prev, page));
      if (messagesRef.current.length === 0) setHasMore(page.length === PAGE_SIZE);
      setReactions(await fetchReactions([...new Set([...messagesRef.current, ...page].map((m) => m.id))]));
    } catch (e) {
      setLoadError(e);
    }
  }, [id]);

  // Load (or catch up after returning to the screen) and receive live updates.
  useFocusEffect(
    useCallback(() => {
      loadInitial();
      return subscribeToConversation(id, {
        onMessage: (m) => setMessages((prev) => mergeMessages(prev, [m])),
        onReactionChange: refreshReactions,
      });
    }, [id, loadInitial, refreshReactions]),
  );

  // Mark as read and fetch read receipts whenever the newest message changes.
  const newestId = messages[0]?.id;
  useEffect(() => {
    if (!newestId || details?.my_status !== 'active') return;
    markConversationRead(id, newestId).catch(() => undefined);
    conversationReadState(id).then(
      (rows) => setReadUpTo(rows.length ? Math.min(...rows.map((r) => r.last_read_message_id ?? 0)) : null),
      () => undefined,
    );
  }, [id, newestId, details?.my_status]);

  async function loadOlder() {
    if (!hasMore || loadingOlder.current || messages.length === 0) return;
    loadingOlder.current = true;
    try {
      const page = await fetchMessages(id, messages[messages.length - 1].id);
      setHasMore(page.length === PAGE_SIZE);
      setMessages((prev) => mergeMessages(prev, page));
      const more = await fetchReactions(page.map((m) => m.id));
      setReactions((prev) => [...prev, ...more]);
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      loadingOlder.current = false;
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setActionError(null);
    try {
      const newId = await sendTextMessage(id, body, replyTo?.id);
      setText('');
      setReplyTo(null);
      const m = await fetchMessage(newId);
      if (m) setMessages((prev) => mergeMessages(prev, [m]));
      if (details?.my_status === 'request') setDetails({ ...details, my_status: 'active' });
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setSending(false);
    }
  }

  async function sendPhoto() {
    setSending(true);
    setActionError(null);
    try {
      if (await pickAndSendPhoto(id, replyTo?.id)) {
        setReplyTo(null);
        const page = await fetchMessages(id);
        setMessages((prev) => mergeMessages(prev, page));
      }
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setSending(false);
    }
  }

  async function react(m: ChatMessage, emoji: Reaction | null) {
    try {
      await reactToMessage(m.id, emoji);
      await refreshReactions();
    } catch (e) {
      setActionError(friendlyError(e));
    }
  }

  function openActions(m: ChatMessage) {
    if (m.kind === 'system' || m.deleted_at || details?.my_status !== 'active') return;
    const mine = m.sender_id === me;
    Alert.alert('Message', undefined, [
      { text: 'React', onPress: () => chooseReaction(m) },
      { text: 'Reply', onPress: () => setReplyTo(m) },
      ...(mine
        ? [
            {
              text: 'Unsend for everyone',
              style: 'destructive' as const,
              onPress: async () => {
                try {
                  await deleteMessage(m.id);
                  const updated = await fetchMessage(m.id);
                  if (updated) setMessages((prev) => mergeMessages(prev, [updated]));
                } catch (e) {
                  setActionError(friendlyError(e));
                }
              },
            },
          ]
        : [
            {
              text: 'Report message',
              onPress: () =>
                router.push({
                  pathname: '/report',
                  params: { type: 'message', id: String(m.id), name: names.get(m.sender_id ?? '') ?? '', user: m.sender_id ?? '' },
                }),
            },
          ]),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  function chooseReaction(m: ChatMessage) {
    const mineNow = reactions.find((r) => r.message_id === m.id && r.user_id === me);
    Alert.alert('React', undefined, [
      ...REACTIONS.map((e) => ({ text: e, onPress: () => react(m, e) })),
      ...(mineNow ? [{ text: 'Remove my reaction', onPress: () => react(m, null) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function answerRequest(accept: boolean) {
    try {
      await respondMessageRequest(id, accept);
      if (accept) setDetails(details ? { ...details, my_status: 'active' } : details);
      else router.back();
    } catch (e) {
      setActionError(friendlyError(e));
    }
  }

  const other = details?.kind === 'direct' ? details.members.find((m) => m.user_id !== me) : undefined;
  const title = details?.kind === 'group' ? details.title ?? 'Group' : other?.display_name ?? 'Chat';
  const names = new Map(details?.members.map((m) => [m.user_id, m.display_name]) ?? []);

  function confirmBlock() {
    if (!other) return;
    Alert.alert(`Block ${other.display_name}?`, 'They won\'t be able to message you or see you anywhere in NearMalayali. They are not told.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          try {
            await blockUser(other.user_id);
            router.back();
          } catch (e) {
            setActionError(friendlyError(e));
          }
        },
      },
    ]);
  }

  if (loadError && details === undefined) return <ErrorView message={friendlyError(loadError)} onRetry={loadInitial} />;
  if (details === undefined) return <LoadingView />;
  if (details === null) {
    return <ErrorView message="This conversation isn't available. You may have left it, or the other person is no longer available." />;
  }

  // My last message, for the "Seen" receipt in direct chats.
  const myLatest = messages.find((m) => m.sender_id === me && m.kind !== 'system');

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Conversation details"
              onPress={() => router.push({ pathname: '/chat-info/[id]', params: { id } })}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="information-circle-outline" size={26} color={c.primary} />
            </Pressable>
          ),
        }}
      />
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {details.my_status === 'request' ? (
          <View style={{ padding: Spacing.md, gap: Spacing.sm, backgroundColor: c.surfaceMuted }}>
            <AppText>
              {other ? `${other.display_name} isn't connected with you and wants to message you.` : 'You were invited to this chat.'} They
              won't see that you've read their messages until you accept.
            </AppText>
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Accept" onPress={() => answerRequest(true)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Delete" variant="secondary" onPress={() => answerRequest(false)} />
              </View>
              {other ? (
                <View style={{ flex: 1 }}>
                  <Button title="Block" variant="danger" onPress={confirmBlock} />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => String(m.id)}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm }}
          ListFooterComponent={
            !hasMore ? (
              <AppText variant="caption" muted style={{ textAlign: 'center', marginBottom: Spacing.md }}>
                Messages are encrypted in transit and stored securely by NearMalayali. They are not end-to-end encrypted.
              </AppText>
            ) : null
          }
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              mine={item.sender_id === me}
              senderName={details.kind === 'group' && item.sender_id !== me ? names.get(item.sender_id ?? '') ?? 'Former member' : null}
              replyTo={item.reply_to_id ? messages.find((m) => m.id === item.reply_to_id) ?? null : undefined}
              reactions={reactions.filter((r) => r.message_id === item.id)}
              me={me}
              seen={details.kind === 'direct' && item.id === myLatest?.id && readUpTo !== null && readUpTo >= item.id}
              onLongPress={() => openActions(item)}
              onReactionPress={(emoji) => {
                const mine = reactions.find((r) => r.message_id === item.id && r.user_id === me);
                react(item, mine?.emoji === emoji ? null : emoji);
              }}
            />
          )}
        />

        {actionError ? (
          <View style={{ paddingHorizontal: Spacing.md }}>
            <Banner message={actionError} />
          </View>
        ) : null}
        {replyTo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: Spacing.sm, backgroundColor: c.surfaceMuted }}>
            <Ionicons name="return-down-forward" size={18} color={c.textSecondary} />
            <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
              Replying to {replyTo.sender_id === me ? 'yourself' : names.get(replyTo.sender_id ?? '') ?? 'message'}: {preview(replyTo)}
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={() => setReplyTo(null)} style={{ padding: Spacing.sm }}>
              <Ionicons name="close" size={20} color={c.textSecondary} />
            </Pressable>
          </View>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: Spacing.sm,
            padding: Spacing.sm,
            borderTopWidth: 1,
            borderTopColor: c.border,
            backgroundColor: c.surface,
          }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send a photo"
            disabled={sending}
            onPress={sendPhoto}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="image-outline" size={26} color={c.primary} />
          </Pressable>
          <TextInput
            accessibilityLabel="Message"
            value={text}
            onChangeText={setText}
            placeholder={details.my_status === 'request' ? 'Reply to accept…' : 'Message'}
            placeholderTextColor={c.textSecondary}
            multiline
            maxLength={4000}
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 140,
              borderRadius: Radius.lg,
              borderWidth: 1,
              borderColor: c.border,
              paddingHorizontal: Spacing.md,
              paddingTop: 11,
              paddingBottom: 11,
              color: c.text,
              fontSize: FontSize.body,
              backgroundColor: c.background,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!text.trim() || sending}
            onPress={send}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || sending ? 0.4 : 1 }}>
            <Ionicons name="send" size={24} color={c.primary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function preview(m: ChatMessage): string {
  if (m.deleted_at) return 'Message deleted';
  if (m.kind === 'image') return 'Photo';
  if (m.kind === 'video') return 'Video';
  return m.body ?? '';
}

function MessageBubble({
  message: m,
  mine,
  senderName,
  replyTo,
  reactions,
  me,
  seen,
  onLongPress,
  onReactionPress,
}: {
  message: ChatMessage;
  mine: boolean;
  senderName: string | null;
  replyTo: ChatMessage | null | undefined;
  reactions: MessageReaction[];
  me?: string;
  seen: boolean;
  onLongPress: () => void;
  onReactionPress: (emoji: Reaction) => void;
}) {
  const c = useTheme();
  if (m.kind === 'system') {
    return (
      <AppText variant="caption" muted style={{ textAlign: 'center', marginVertical: Spacing.xs }}>
        {m.body}
      </AppText>
    );
  }
  const counts = new Map<Reaction, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  const myReaction = reactions.find((r) => r.user_id === me)?.emoji;

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
      {senderName ? (
        <AppText variant="caption" muted style={{ marginLeft: Spacing.sm }}>
          {senderName}
        </AppText>
      ) : null}
      <Pressable
        onLongPress={onLongPress}
        accessibilityHint="Long press for reactions, reply and unsend"
        style={{
          maxWidth: '80%',
          backgroundColor: mine ? c.primary : c.surface,
          borderColor: c.border,
          borderWidth: mine ? 0 : 1,
          borderRadius: Radius.md,
          padding: Spacing.sm,
          gap: Spacing.xs,
        }}>
        {replyTo !== undefined ? (
          <View style={{ borderLeftWidth: 3, borderLeftColor: mine ? c.primaryText : c.primary, paddingLeft: Spacing.sm, opacity: 0.8 }}>
            <AppText variant="caption" numberOfLines={2} style={{ color: mine ? c.primaryText : c.text }}>
              {replyTo ? preview(replyTo) : 'Earlier message'}
            </AppText>
          </View>
        ) : null}
        {m.deleted_at ? (
          <AppText style={{ fontStyle: 'italic', color: mine ? c.primaryText : c.textSecondary }}>Message deleted</AppText>
        ) : m.kind === 'image' && m.attachment_path ? (
          <ChatImage path={m.attachment_path} width={m.attachment_meta?.width} height={m.attachment_meta?.height} />
        ) : m.kind === 'video' ? (
          <AppText style={{ color: mine ? c.primaryText : c.text }}>Video messages aren't supported in this version yet.</AppText>
        ) : (
          <AppText selectable style={{ color: mine ? c.primaryText : c.text }}>
            {m.body}
          </AppText>
        )}
        <AppText variant="caption" style={{ color: mine ? c.primaryText : c.textSecondary, opacity: 0.8, alignSelf: 'flex-end', fontSize: 11 }}>
          {clockTime(m.created_at)}
        </AppText>
      </Pressable>
      {counts.size ? (
        <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
          {[...counts.entries()].map(([emoji, n]) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`${emoji} ${n}${myReaction === emoji ? ', including you. Tap to remove' : ''}`}
              onPress={() => onReactionPress(emoji)}
              style={{
                flexDirection: 'row',
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: Radius.pill,
                borderWidth: 1,
                borderColor: myReaction === emoji ? c.primary : c.border,
                backgroundColor: c.surface,
              }}>
              <AppText variant="caption">
                {emoji} {n > 1 ? n : ''}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
      {seen ? (
        <AppText variant="caption" muted style={{ fontSize: 11 }}>
          Seen
        </AppText>
      ) : null}
    </View>
  );
}

function ChatImage({ path, width, height }: { path: string; width?: number; height?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    signedMediaUrl(path).then(
      (u) => active && setUrl(u),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [path]);
  const ratio = width && height ? width / height : 4 / 3;
  if (failed) return <AppText variant="caption">Photo couldn't be loaded.</AppText>;
  return (
    <Image
      source={url ? { uri: url } : undefined}
      accessibilityLabel="Photo"
      style={{ width: 220, height: 220 / ratio, borderRadius: Radius.sm, backgroundColor: '#0002' }}
      contentFit="cover"
    />
  );
}
