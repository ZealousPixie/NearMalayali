// Inbox: conversations and message requests, updated live.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Avatar, Banner, Button, ChoiceChips, EmptyState, LoadingView, Screen, TextField } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { type ConversationSummary, listConversations, searchMessages, subscribeToInbox } from '@/lib/chat';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/format';

type Box = 'active' | 'requests';

export default function MessagesTab() {
  const c = useTheme();
  const [box, setBox] = useState<Box>('active');
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchMessages>> | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, requests] = await Promise.all([listConversations(box), listConversations('requests')]);
      setItems(list);
      setRequestCount(requests.length);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [box]);

  useFocusEffect(
    useCallback(() => {
      load();
      return subscribeToInbox(load);
    }, [load]),
  );

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      searchMessages(q).then(
        (r) => active && setResults(r),
        (e) => active && setError(friendlyError(e)),
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const searching = query.trim().length >= 2;

  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="title">Messages</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New message"
          onPress={() => router.push('/new-chat')}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="create-outline" size={26} color={c.primary} />
        </Pressable>
      </View>
      <TextField label="Search messages" value={query} onChangeText={setQuery} placeholder="Search your chats" autoCapitalize="none" />
      {error ? <Banner message={error} action={<Button title="Retry" variant="ghost" onPress={load} />} /> : null}

      {searching ? (
        results === null ? (
          <LoadingView label="Searching…" />
        ) : results.length === 0 ? (
          <AppText muted>No messages match "{query.trim()}".</AppText>
        ) : (
          results.map((r) => (
            <Pressable
              key={r.message_id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: r.conversation_id } })}
              style={{ paddingVertical: Spacing.sm, gap: 2 }}>
              <AppText variant="caption" muted>
                {r.sender_name ?? 'Someone'} · {timeAgo(r.created_at)}
              </AppText>
              <AppText numberOfLines={2}>{r.body}</AppText>
            </Pressable>
          ))
        )
      ) : (
        <>
          <ChoiceChips
            options={[
              { value: 'active', label: 'Chats' },
              { value: 'requests', label: requestCount ? `Requests (${requestCount})` : 'Requests' },
            ]}
            value={box}
            onChange={(v) => {
              setItems(null);
              setBox(v);
            }}
          />
          {items === null && !error ? <LoadingView /> : null}
          {items?.length === 0 ? (
            box === 'active' ? (
              <EmptyState
                icon="chatbubbles-outline"
                title="No conversations yet"
                message="Message a connection from their profile, or start a group chat."
                action={<Button title="New message" icon="create-outline" onPress={() => router.push('/new-chat')} />}
              />
            ) : (
              <EmptyState
                icon="mail-unread-outline"
                title="No message requests"
                message="Messages from people you're not connected with arrive here, depending on your privacy settings."
              />
            )
          ) : null}
          {items?.map((item) => (
            <Pressable
              key={item.conversation_id}
              accessibilityRole="button"
              accessibilityLabel={`Conversation with ${item.title ?? 'group'}${item.unread_count ? `, ${item.unread_count} unread` : ''}`}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.conversation_id } })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.md,
                paddingVertical: Spacing.sm,
                opacity: pressed ? 0.7 : 1,
              })}>
              {item.kind === 'group' ? (
                <View
                  style={{ width: 48, height: 48, borderRadius: Radius.pill, backgroundColor: c.primaryMuted, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="people" size={24} color={c.primary} />
                </View>
              ) : (
                <Avatar path={item.avatar_path} name={item.title ?? '?'} />
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm }}>
                  <AppText style={{ fontWeight: item.unread_count ? '700' : '600', flex: 1 }} numberOfLines={1}>
                    {item.title ?? 'Conversation'}
                  </AppText>
                  <AppText variant="caption" muted>
                    {timeAgo(item.last_message_at)}
                  </AppText>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                  {item.muted ? <Ionicons name="notifications-off-outline" size={14} color={c.textSecondary} /> : null}
                  <AppText variant="caption" muted={!item.unread_count} numberOfLines={1} style={{ flex: 1 }}>
                    {item.last_message_preview ?? ''}
                  </AppText>
                  {item.unread_count ? (
                    <View style={{ backgroundColor: c.primary, borderRadius: Radius.pill, minWidth: 20, paddingHorizontal: 6, alignItems: 'center' }}>
                      <AppText variant="caption" style={{ color: c.primaryText, fontWeight: '700' }}>
                        {item.unread_count > 99 ? '99+' : item.unread_count}
                      </AppText>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))}
        </>
      )}
    </Screen>
  );
}
