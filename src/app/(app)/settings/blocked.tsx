import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Avatar, Banner, Button, Card, Divider, EmptyState, ErrorView, LoadingView, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { listBlockedUsers, unblockUser } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import type { PersonSummary } from '@/lib/types';

export default function BlockedPeople() {
  const { data, error: loadError, reload: load, setData: setPeople } = useAsync<PersonSummary[]>(listBlockedUsers);
  const people = data ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function unblock(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await unblockUser(id);
      setPeople(people?.filter((x) => x.id !== id) ?? []);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  }

  if (loadError && !people) return <ErrorView message={friendlyError(loadError)} onRetry={load} />;
  if (!people) return <LoadingView />;

  return (
    <Screen edges={['bottom']}>
      {error ? <Banner message={error} /> : null}
      {people.length === 0 ? (
        <EmptyState icon="ban-outline" title="No one blocked" message="People you block can't find, see or contact you, and you won't see them." />
      ) : (
        <Card>
          {people.map((p, i) => (
            <View key={p.id} style={{ gap: Spacing.sm }}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
                <Avatar path={p.avatar_path} name={p.display_name} size={40} />
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontWeight: '600' }}>{p.display_name}</AppText>
                  <AppText variant="caption" muted>
                    @{p.username}
                  </AppText>
                </View>
                <View style={{ width: 120 }}>
                  <Button title="Unblock" variant="secondary" loading={busyId === p.id} onPress={() => unblock(p.id)} />
                </View>
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
