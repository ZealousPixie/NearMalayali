// Your connections, connection requests, followers and who you follow.
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { PersonRow } from '@/components/person-row';
import { AppText, Banner, Button, Card, ChoiceChips, EmptyState, LoadingView, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/format';
import {
  cancelConnectionRequest,
  type ConnectionRequest,
  listConnectionRequests,
  listConnections,
  listFollows,
  removeFollower,
  respondConnectionRequest,
  type SocialPerson,
} from '@/lib/social';
import { useAuth } from '@/providers/auth-provider';

type Tab = 'connections' | 'requests' | 'followers' | 'following';
const TABS: { value: Tab; label: string }[] = [
  { value: 'connections', label: 'Connections' },
  { value: 'requests', label: 'Requests' },
  { value: 'followers', label: 'Followers' },
  { value: 'following', label: 'Following' },
];

interface Data {
  people?: SocialPerson[];
  incoming?: ConnectionRequest[];
  outgoing?: ConnectionRequest[];
}

export default function ConnectionsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const { session } = useAuth();
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.value === params.tab) ? (params.tab as Tab) : 'connections');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      if (tab === 'connections') setData({ people: await listConnections(session.user.id) });
      else if (tab === 'requests') {
        const [incoming, outgoing] = await Promise.all([listConnectionRequests('incoming'), listConnectionRequests('outgoing')]);
        setData({ incoming, outgoing });
      } else setData({ people: await listFollows(tab) });
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [session, tab]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function act(key: number | string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  function changeTab(t: Tab) {
    setData(null);
    setTab(t);
  }

  return (
    <Screen edges={['bottom']}>
      <ChoiceChips options={TABS} value={tab} onChange={changeTab} />
      {error ? <Banner message={error} action={<Button title="Retry" variant="ghost" onPress={load} />} /> : null}
      {!data && !error ? <LoadingView /> : null}

      {data?.people ? (
        data.people.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title={tab === 'connections' ? 'No connections yet' : tab === 'followers' ? 'No followers yet' : 'Not following anyone'}
            message="Find people on Discover or by searching, then connect or follow from their profile."
          />
        ) : (
          <View>
            {data.people.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <PersonRow person={p} />
                </View>
                {tab === 'followers' ? (
                  <Button
                    title="Remove"
                    variant="ghost"
                    loading={busy === p.id}
                    onPress={() => act(p.id, () => removeFollower(p.id))}
                  />
                ) : null}
              </View>
            ))}
          </View>
        )
      ) : null}

      {data?.incoming ? (
        <View style={{ gap: Spacing.md }}>
          <AppText variant="subtitle">Received</AppText>
          {data.incoming.length === 0 ? (
            <AppText muted>No pending requests.</AppText>
          ) : (
            data.incoming.map((r) => (
              <Card key={r.request_id}>
                <PersonRow person={r} detail={timeAgo(r.created_at)} />
                {r.message ? <AppText>“{r.message}”</AppText> : null}
                <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Accept"
                      icon="checkmark"
                      loading={busy === r.request_id}
                      onPress={() => act(r.request_id, () => respondConnectionRequest(r.request_id, true))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Decline"
                      variant="secondary"
                      disabled={busy === r.request_id}
                      onPress={() => act(r.request_id, () => respondConnectionRequest(r.request_id, false))}
                    />
                  </View>
                </View>
              </Card>
            ))
          )}
          <AppText variant="subtitle">Sent</AppText>
          {data.outgoing?.length ? (
            data.outgoing.map((r) => (
              <View key={r.request_id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <PersonRow person={r} detail={timeAgo(r.created_at)} />
                </View>
                <Button
                  title="Cancel"
                  variant="ghost"
                  loading={busy === r.request_id}
                  onPress={() => act(r.request_id, () => cancelConnectionRequest(r.request_id))}
                />
              </View>
            ))
          ) : (
            <AppText muted>No sent requests waiting.</AppText>
          )}
          <AppText variant="caption" muted>
            Declining is private: the other person isn't told.
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}
