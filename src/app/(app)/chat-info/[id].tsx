// Conversation details: members, mute, rename, add/remove members, leave.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText, Avatar, Banner, Button, ChoiceChips, Divider, ErrorView, ListRow, LoadingView, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  type ChatMember,
  type ConversationDetails,
  conversationDetails,
  leaveConversation,
  muteConversation,
  removeConversationMember,
  renameConversation,
  setConversationAdmin,
} from '@/lib/chat';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/providers/auth-provider';

type Mute = 'off' | '8h' | '1w' | 'always';
const MUTE_OPTIONS: { value: Mute; label: string }[] = [
  { value: 'off', label: 'Not muted' },
  { value: '8h', label: '8 hours' },
  { value: '1w', label: '1 week' },
  { value: 'always', label: 'Until I unmute' },
];

function muteUntil(choice: Mute): Date | null {
  const now = Date.now();
  if (choice === '8h') return new Date(now + 8 * 3600_000);
  if (choice === '1w') return new Date(now + 7 * 86400_000);
  if (choice === 'always') return new Date('2999-01-01T00:00:00Z');
  return null;
}

function currentMute(until: string | null): Mute | null {
  if (!until || new Date(until).getTime() < Date.now()) return 'off';
  return new Date(until).getFullYear() > 2900 ? 'always' : null;
}

export default function ChatInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session?.user.id;
  const [details, setDetails] = useState<ConversationDetails | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [mute, setMute] = useState<Mute | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await conversationDetails(id);
      setDetails(d);
      setTitle(d?.title ?? '');
      setMute(currentMute(d?.muted_until ?? null));
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

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    }
  }

  if (error && details === undefined) return <ErrorView message={friendlyError(error)} onRetry={load} />;
  if (details === undefined) return <LoadingView />;
  if (details === null) return <ErrorView message="This conversation isn't available." />;

  const isAdmin = details.my_role === 'admin';
  const isGroup = details.kind === 'group';
  const managedByGroup = Boolean(details.group_id);
  const other = details.members.find((m) => m.user_id !== me);

  function memberActions(m: ChatMember) {
    if (m.user_id === me) return;
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [
      { text: 'View profile', onPress: () => router.push({ pathname: '/profile/[id]', params: { id: m.user_id } }) },
    ];
    if (isGroup && isAdmin && !managedByGroup) {
      options.push({
        text: m.role === 'admin' ? 'Remove as admin' : 'Make admin',
        onPress: () => act(() => setConversationAdmin(id, m.user_id, m.role !== 'admin')),
      });
      options.push({ text: 'Remove from chat', style: 'destructive', onPress: () => act(() => removeConversationMember(id, m.user_id)) });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(m.display_name, undefined, options);
  }

  function confirmLeave() {
    Alert.alert(isGroup ? 'Leave this group chat?' : 'Delete this chat?', isGroup
      ? 'You will stop receiving its messages. Members see that you left.'
      : 'It is removed from your inbox. If they message you again, it will reappear without the earlier history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isGroup ? 'Leave' : 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveConversation(id);
            router.dismissTo('/messages');
          } catch (e) {
            setActionError(friendlyError(e));
          }
        },
      },
    ]);
  }

  return (
    <Screen edges={['bottom']}>
      {actionError ? <Banner message={actionError} /> : null}
      {isGroup ? (
        isAdmin ? (
          <View style={{ gap: Spacing.sm }}>
            <TextField label="Group name" value={title} onChangeText={setTitle} maxLength={80} />
            <Button
              title="Save name"
              variant="secondary"
              disabled={!title.trim() || title.trim() === details.title}
              onPress={() => act(() => renameConversation(id, title))}
            />
          </View>
        ) : (
          <AppText variant="title">{details.title}</AppText>
        )
      ) : null}

      <ChoiceChips
        label="Mute notifications"
        options={mute === null ? [{ value: 'custom' as Mute, label: 'Muted' }, ...MUTE_OPTIONS] : MUTE_OPTIONS}
        value={mute ?? ('custom' as Mute)}
        onChange={(v) => {
          setMute(v);
          act(() => muteConversation(id, muteUntil(v)));
        }}
      />

      <Divider />
      <AppText variant="subtitle">{isGroup ? `${details.members.length} members` : 'Member'}</AppText>
      {details.members.map((m) => (
        <ListRow
          key={m.user_id}
          label={`${m.display_name}${m.user_id === me ? ' (you)' : ''}`}
          detail={[m.role === 'admin' && isGroup ? 'Admin' : null, m.status === 'request' ? 'Hasn\'t accepted yet' : null].filter(Boolean).join(' · ') || undefined}
          icon="person-circle-outline"
          onPress={() => memberActions(m)}
        />
      ))}
      {isGroup && isAdmin && !managedByGroup ? (
        <Button title="Add people" icon="person-add-outline" variant="secondary" onPress={() => router.push({ pathname: '/new-chat', params: { addTo: id } })} />
      ) : null}
      {managedByGroup ? (
        <AppText variant="caption" muted>
          Membership of this chat follows the community group it belongs to.
        </AppText>
      ) : null}
      {!isGroup && other ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
          <Avatar path={other.avatar_path} name={other.display_name} size={36} />
          <AppText variant="caption" muted style={{ flex: 1 }}>
            To block or report {other.display_name}, open their profile.
          </AppText>
        </View>
      ) : null}

      <Divider />
      <Button title={isGroup ? 'Leave group chat' : 'Delete chat'} variant="danger" icon="exit-outline" onPress={confirmLeave} />
      <AppText variant="caption" muted>
        Messages are encrypted in transit and stored securely. They are not end-to-end encrypted.
      </AppText>
    </Screen>
  );
}
