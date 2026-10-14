// Start a chat: pick one connection for a direct chat, or several for a group.
// To message someone who isn't a connection, use Message on their profile.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { AppText, Avatar, Banner, Button, Checkbox, EmptyState, ErrorView, LoadingView, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { addConversationMembers, createGroupConversation, startDirectConversation } from '@/lib/chat';
import { friendlyError } from '@/lib/errors';
import { listConnections } from '@/lib/social';
import { useAuth } from '@/providers/auth-provider';

export default function NewChat() {
  // With ?addTo=<conversation id> this screen adds members to an existing group.
  const { addTo } = useLocalSearchParams<{ addTo?: string }>();
  const { session } = useAuth();
  const load = useCallback(() => listConnections(session!.user.id), [session]);
  const { data: connections, error, reload } = useAsync(load);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function toggle(id: string, on: boolean) {
    setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  }

  async function start() {
    setBusy(true);
    setActionError(null);
    try {
      if (addTo) {
        await addConversationMembers(addTo, selected);
        router.back();
        return;
      }
      const id =
        selected.length === 1 ? await startDirectConversation(selected[0]) : await createGroupConversation(title.trim(), selected);
      router.replace({ pathname: '/chat/[id]', params: { id } });
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !connections) return <ErrorView message={friendlyError(error)} onRetry={reload} />;
  if (!connections) return <LoadingView />;

  const isGroup = !addTo && selected.length > 1;
  const visible = connections.filter((p) =>
    `${p.display_name} ${p.username}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Screen edges={['bottom']}>
      {connections.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No connections yet"
          message="You can start chats and groups with your connections. To message someone else, open their profile and tap Message."
        />
      ) : (
        <>
          <TextField label="Search connections" value={filter} onChangeText={setFilter} autoCapitalize="none" />
          <View style={{ gap: Spacing.xs }}>
            {visible.map((p) => (
              <Checkbox key={p.id} checked={selected.includes(p.id)} onChange={(on) => toggle(p.id, on)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
                  <Avatar path={p.avatar_path} name={p.display_name} size={36} />
                  <View>
                    <AppText style={{ fontWeight: '600' }}>{p.display_name}</AppText>
                    <AppText variant="caption" muted>
                      @{p.username}
                    </AppText>
                  </View>
                </View>
              </Checkbox>
            ))}
          </View>
          {isGroup ? (
            <TextField label="Group name" value={title} onChangeText={setTitle} maxLength={80} placeholder="e.g. Perth Onam committee" />
          ) : null}
          {actionError ? <Banner message={actionError} /> : null}
          <Button
            title={addTo ? `Add ${selected.length || ''} to group` : isGroup ? 'Create group' : 'Start chat'}
            icon="chatbubbles-outline"
            loading={busy}
            disabled={selected.length === 0 || (isGroup && !title.trim())}
            onPress={start}
          />
        </>
      )}
    </Screen>
  );
}
