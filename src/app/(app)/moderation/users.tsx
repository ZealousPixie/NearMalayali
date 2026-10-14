// Find a member by username or name (moderators).
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { AppText, Banner, Card, Screen, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { findUsers, type ModUser } from '@/lib/moderation';

export default function ModUsers() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<ModUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let active = true;
    const t = setTimeout(() => {
      findUsers(query).then(
        (u) => active && setUsers(u),
        (e) => active && setError(friendlyError(e)),
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <Screen edges={['bottom']}>
      <TextField label="Username or name" value={query} onChangeText={setQuery} autoCapitalize="none" autoFocus />
      {error ? <Banner message={error} /> : null}
      {query.trim().length >= 2
        ? users.map((u) => (
            <Pressable key={u.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/moderation/user/[id]', params: { id: u.id } })}>
              <Card>
                <AppText style={{ fontWeight: '600' }}>
                  {u.display_name} {u.username ? `(@${u.username})` : ''}
                </AppText>
                <AppText variant="caption" muted>
                  {u.account_status} · joined {new Date(u.created_at).toLocaleDateString()} · {u.reports_against} reports
                  {u.roles.length ? ` · ${u.roles.join(', ')}` : ''}
                </AppText>
              </Card>
            </Pressable>
          ))
        : null}
    </Screen>
  );
}
