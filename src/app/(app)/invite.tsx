// Invite connections to a group (?kind=group) or an event (?kind=event).
import { useCallback, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { AppText, Avatar, Banner, Button, EmptyState, ErrorView, LoadingView, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { inviteToEvent, inviteToGroup } from '@/lib/community';
import { friendlyError } from '@/lib/errors';
import { listConnections } from '@/lib/social';
import { useAuth } from '@/providers/auth-provider';

export default function Invite() {
  const { kind, id } = useLocalSearchParams<{ kind: 'group' | 'event'; id: string }>();
  const { session } = useAuth();
  const load = useCallback(() => listConnections(session!.user.id), [session]);
  const { data: people, error, reload } = useAsync(load);
  const [filter, setFilter] = useState('');
  const [invited, setInvited] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function invite(userId: string) {
    setBusy(userId);
    setActionError(null);
    try {
      await (kind === 'event' ? inviteToEvent(id, userId) : inviteToGroup(id, userId));
      setInvited((s) => [...s, userId]);
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  if (error && !people) return <ErrorView message={friendlyError(error)} onRetry={reload} />;
  if (!people) return <LoadingView />;
  const visible = people.filter((p) => `${p.display_name} ${p.username}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Screen edges={['bottom']}>
      {people.length === 0 ? (
        <EmptyState icon="people-outline" title="No connections to invite" message="You can invite people you're connected with." />
      ) : (
        <>
          <TextField label="Search connections" value={filter} onChangeText={setFilter} autoCapitalize="none" />
          {actionError ? <Banner message={actionError} /> : null}
          {visible.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
              <Avatar path={p.avatar_path} name={p.display_name} size={40} />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontWeight: '600' }}>{p.display_name}</AppText>
                <AppText variant="caption" muted>
                  @{p.username}
                </AppText>
              </View>
              <Button
                title={invited.includes(p.id) ? 'Invited' : 'Invite'}
                variant={invited.includes(p.id) ? 'ghost' : 'secondary'}
                disabled={invited.includes(p.id)}
                loading={busy === p.id}
                onPress={() => invite(p.id)}
              />
            </View>
          ))}
          <AppText variant="caption" muted>
            People who are already members or already invited aren't notified again.
          </AppText>
        </>
      )}
    </Screen>
  );
}
