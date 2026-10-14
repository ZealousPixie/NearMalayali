// In-app notification centre. Works even when push is unavailable.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Banner, Button, Divider, EmptyState, ErrorView, LoadingView, Screen } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { type AppNotification, fetchNotifications, markAllNotificationsRead, markNotificationsRead } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { openNotificationTarget } from '@/lib/notification-routing';

const PAGE = 30;

export default function NotificationsScreen() {
  const c = useTheme();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await fetchNotifications(undefined, PAGE);
      setLoadError(null);
      setItems(page);
      setHasMore(page.length === PAGE);
    } catch (e) {
      setLoadError(e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function more() {
    if (!items?.length) return;
    setLoadingMore(true);
    try {
      const page = await fetchNotifications(items[items.length - 1].created_at, PAGE);
      setItems([...items, ...page]);
      setHasMore(page.length === PAGE);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function open(n: AppNotification) {
    if (!n.read_at) {
      try {
        await markNotificationsRead([n.id]);
        setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null);
      } catch (e) {
        setError(friendlyError(e));
      }
    }
    openNotificationTarget(n.data);
  }

  async function readAll() {
    try {
      await markAllNotificationsRead();
      setItems((list) => list?.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) ?? null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  if (loadError && !items) return <ErrorView message={friendlyError(loadError)} onRetry={load} />;
  if (!items) return <LoadingView />;

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <Screen edges={['bottom']}>
      {error ? <Banner message={error} /> : null}
      {unread > 0 ? <Button title="Mark all as read" variant="secondary" icon="checkmark-done" onPress={readAll} /> : null}
      {items.length === 0 ? (
        <EmptyState icon="notifications-outline" title="No notifications yet" message="Alerts about nearby Malayalis and account activity will appear here." />
      ) : (
        <View>
          {items.map((n, i) => (
            <View key={n.id}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${n.read_at ? '' : 'Unread. '}${n.title}. ${n.body}`}
                onPress={() => open(n)}
                style={({ pressed }) => ({ flexDirection: 'row', gap: Spacing.md, paddingVertical: Spacing.md, opacity: pressed ? 0.7 : 1 })}>
                <Ionicons name={n.kind === 'proximity' ? 'people-circle' : 'notifications'} size={28} color={n.read_at ? c.textSecondary : c.primary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText style={{ fontWeight: n.read_at ? '400' : '700' }}>{n.title}</AppText>
                  <AppText muted>{n.body}</AppText>
                  <AppText variant="caption" muted>
                    {new Date(n.created_at).toLocaleString()}
                  </AppText>
                </View>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {hasMore ? <Button title="Older notifications" variant="ghost" onPress={more} loading={loadingMore} /> : null}
      <Button title="Notification settings" variant="ghost" onPress={() => router.push('/settings/notifications')} />
    </Screen>
  );
}
