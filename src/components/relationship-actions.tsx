// Connect / follow / message buttons on someone else's profile. Each button
// calls the server and shows the server's answer; nothing is assumed.
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { AppText, Banner, Button } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { startDirectConversation } from '@/lib/chat';
import { friendlyError } from '@/lib/errors';
import {
  cancelConnectionRequest,
  followUser,
  getRelationship,
  profileStats,
  type Relationship,
  removeConnection,
  respondConnectionRequest,
  sendConnectionRequest,
  unfollowUser,
} from '@/lib/social';

export function RelationshipActions({ userId, name }: { userId: string; name: string }) {
  const load = useCallback(async () => {
    const [relationship, stats] = await Promise.all([getRelationship(userId), profileStats(userId)]);
    return { relationship, stats };
  }, [userId]);
  const { data, error, reload } = useAsync(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice(success);
      reload();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <Banner message={friendlyError(error)} action={<Button title="Retry" variant="ghost" onPress={reload} />} />;
  if (!data) return null;
  const r: Relationship | null = data.relationship;
  if (!r) return null;

  const canMessage = r.connected || r.message_permission !== 'connections_only';

  function confirmRemove() {
    Alert.alert(`Remove ${name} as a connection?`, 'They are not told. You can send a new request later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run('connect', () => removeConnection(userId)) },
    ]);
  }

  return (
    <View style={{ gap: Spacing.sm }}>
      {data.stats ? <Stats stats={data.stats} /> : null}
      {r.followed_by ? (
        <AppText variant="caption" muted>
          Follows you
        </AppText>
      ) : null}
      {actionError ? <Banner message={actionError} /> : null}
      {notice ? <Banner tone="success" message={notice} /> : null}

      {r.incoming_request_id ? (
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Accept request"
              icon="checkmark"
              loading={busy === 'accept'}
              onPress={() => run('accept', () => respondConnectionRequest(r.incoming_request_id!, true), `You and ${name} are now connected.`)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Decline"
              variant="secondary"
              loading={busy === 'decline'}
              onPress={() => run('decline', () => respondConnectionRequest(r.incoming_request_id!, false))}
            />
          </View>
        </View>
      ) : r.connected ? (
        <Button title="Connected" variant="secondary" icon="people" loading={busy === 'connect'} onPress={confirmRemove} />
      ) : r.outgoing_request_id ? (
        <Button
          title="Request sent · Cancel"
          variant="secondary"
          icon="time-outline"
          loading={busy === 'connect'}
          onPress={() => run('connect', () => cancelConnectionRequest(r.outgoing_request_id!))}
        />
      ) : r.accepts_requests ? (
        <Button
          title="Connect"
          icon="person-add"
          loading={busy === 'connect'}
          onPress={() =>
            run(
              'connect',
              async () => {
                const result = await sendConnectionRequest(userId);
                if (result === 'CONNECTED') setNotice(`You and ${name} are now connected.`);
              },
              undefined,
            )
          }
        />
      ) : (
        <AppText variant="caption" muted>
          {name} isn't accepting connection requests.
        </AppText>
      )}

      <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            title={r.following ? 'Following' : 'Follow'}
            variant="secondary"
            icon={r.following ? 'checkmark' : 'add'}
            loading={busy === 'follow'}
            onPress={() => run('follow', () => (r.following ? unfollowUser(userId) : followUser(userId)))}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Message"
            variant="secondary"
            icon="chatbubble-outline"
            disabled={!canMessage}
            loading={busy === 'message'}
            onPress={() =>
              run('message', async () => {
                const id = await startDirectConversation(userId);
                router.push({ pathname: '/chat/[id]', params: { id } });
              })
            }
          />
        </View>
      </View>
      {!canMessage ? (
        <AppText variant="caption" muted>
          {name} only accepts messages from connections.
        </AppText>
      ) : !r.connected && r.message_permission === 'requests' ? (
        <AppText variant="caption" muted>
          Your first messages arrive as a message request until {name} accepts.
        </AppText>
      ) : null}
    </View>
  );
}

function Stats({ stats }: { stats: { connections: number | null; followers: number; following: number } }) {
  const c = useTheme();
  const items = [
    { label: 'Connections', value: stats.connections },
    { label: 'Followers', value: stats.followers },
    { label: 'Following', value: stats.following },
  ];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.sm }}>
      {items.map((i) => (
        <View key={i.label} style={{ alignItems: 'center' }}>
          <AppText style={{ fontWeight: '700', color: c.text }}>{i.value ?? '–'}</AppText>
          <AppText variant="caption" muted>
            {i.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** Tappable stats for your own profile. */
export function OwnStats({ stats }: { stats: { connections: number | null; followers: number; following: number } }) {
  const c = useTheme();
  const items = [
    { label: 'Connections', value: stats.connections, tab: 'connections' },
    { label: 'Followers', value: stats.followers, tab: 'followers' },
    { label: 'Following', value: stats.following, tab: 'following' },
  ];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.sm }}>
      {items.map((i) => (
        <Pressable
          key={i.label}
          accessibilityRole="button"
          accessibilityLabel={`${i.label}: ${i.value ?? 0}`}
          onPress={() => router.push({ pathname: '/connections', params: { tab: i.tab } })}
          style={{ alignItems: 'center', minWidth: 80, minHeight: 44, justifyContent: 'center' }}>
          <AppText style={{ fontWeight: '700', color: c.text }}>{i.value ?? 0}</AppText>
          <AppText variant="caption" muted>
            {i.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}
