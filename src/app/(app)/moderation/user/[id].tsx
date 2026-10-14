// A member's moderation history and account actions.
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText, Avatar, Banner, Button, Card, ChoiceChips, Divider, ErrorView, LoadingView, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { friendlyError } from '@/lib/errors';
import { type ModUserSummary, myRoles, setRole, suspendUser, unsuspendUser, userSummary, warnUser } from '@/lib/moderation';
import { useAsync } from '@/hooks/use-async';

type Length = '1' | '7' | '30' | 'indefinite';

export default function ModUser() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [user, setUser] = useState<ModUserSummary | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [length, setLength] = useState<Length>('7');
  const loadAdmin = useCallback(async () => (await myRoles()).includes('admin'), []);
  const { data: isAdmin } = useAsync(loadAdmin);

  const load = useCallback(async () => {
    try {
      setUser(await userSummary(id));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function run(label: string, fn: () => Promise<void>) {
    if (reason.trim().length < 3) {
      setActionError('Write a reason first (at least 3 characters).');
      return;
    }
    Alert.alert(label, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: 'destructive',
        onPress: async () => {
          setActionError(null);
          try {
            await fn();
            setReason('');
            await load();
          } catch (e) {
            setActionError(friendlyError(e));
          }
        },
      },
    ]);
  }

  if (error && user === undefined) return <ErrorView message={friendlyError(error)} onRetry={load} />;
  if (user === undefined) return <LoadingView />;
  if (user === null) return <ErrorView message="This member no longer exists." />;

  const suspended = user.account_status === 'suspended';

  return (
    <Screen edges={['bottom']}>
      <View style={{ flexDirection: 'row', gap: Spacing.md, alignItems: 'center' }}>
        <Avatar path={user.avatar_path} name={user.display_name} />
        <View style={{ flex: 1 }}>
          <AppText variant="subtitle">{user.display_name}</AppText>
          <AppText variant="caption" muted>
            @{user.username} · {user.account_status} · joined {new Date(user.created_at).toLocaleDateString()}
            {user.roles.length ? ` · ${user.roles.join(', ')}` : ''}
          </AppText>
        </View>
      </View>
      <AppText muted>
        {user.reports_against} reports against ({user.open_reports_against} open) · {user.reports_made} made
      </AppText>
      {user.restriction ? (
        <Banner
          tone="warning"
          message={`Suspended ${user.restriction.suspended_until ? `until ${new Date(user.restriction.suspended_until).toLocaleString()}` : 'indefinitely'}: ${user.restriction.reason}`}
        />
      ) : null}

      <TextField label="Reason (shown to the member)" value={reason} onChangeText={setReason} multiline maxLength={280} />
      {actionError ? <Banner message={actionError} /> : null}
      {suspended ? (
        <Button title="Lift suspension" onPress={() => run('Lift this suspension?', () => unsuspendUser(user.id, reason))} />
      ) : (
        <>
          <Button title="Send warning" variant="secondary" onPress={() => run('Send this warning?', () => warnUser(user.id, reason))} />
          <ChoiceChips
            label="Suspend for"
            options={[
              { value: '1' as Length, label: '1 day' },
              { value: '7' as Length, label: '7 days' },
              { value: '30' as Length, label: '30 days' },
              ...(isAdmin ? [{ value: 'indefinite' as Length, label: 'Indefinitely' }] : []),
            ]}
            value={length}
            onChange={setLength}
          />
          <Button
            title="Suspend"
            variant="danger"
            onPress={() => run('Suspend this member?', () => suspendUser(user.id, length === 'indefinite' ? null : Number(length), reason))}
          />
        </>
      )}

      {isAdmin ? (
        <Card>
          <AppText style={{ fontWeight: '600' }}>Roles (admins only)</AppText>
          {(['moderator', 'admin'] as const).map((role) => {
            const has = user.roles.includes(role);
            return (
              <Button
                key={role}
                title={has ? `Remove ${role}` : `Make ${role}`}
                variant="secondary"
                onPress={() =>
                  Alert.alert(has ? `Remove ${role} role?` : `Make ${user.display_name} a ${role}?`, undefined, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Confirm',
                      onPress: () => setRole(user.id, role, !has).then(load, (e) => setActionError(friendlyError(e))),
                    },
                  ])
                }
              />
            );
          })}
        </Card>
      ) : null}

      <Divider />
      <AppText variant="subtitle">History</AppText>
      {user.actions.length === 0 ? <AppText muted>No moderation actions.</AppText> : null}
      {user.actions.map((a, i) => (
        <View key={i} style={{ gap: 2 }}>
          <AppText style={{ fontWeight: '600' }}>
            {a.action.replace('_', ' ')}
            {a.target_type ? ` (${a.target_type})` : ''}
          </AppText>
          <AppText variant="caption" muted>
            {new Date(a.created_at).toLocaleString()} by @{a.moderator ?? 'unknown'}
            {a.until ? ` · until ${new Date(a.until).toLocaleDateString()}` : ''}
          </AppText>
          {a.reason ? <AppText>{a.reason}</AppText> : null}
        </View>
      ))}
    </Screen>
  );
}
