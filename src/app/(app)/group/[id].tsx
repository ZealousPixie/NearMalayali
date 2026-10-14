// A community group: join/leave, posts, members, events and admin tools.
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { EventRow } from '@/components/community/events-section';
import { PRIVACY_LABEL } from '@/components/community/groups-section';
import { PersonRow } from '@/components/person-row';
import { PostCard } from '@/components/post-card';
import { AppText, Banner, Button, ChoiceChips, EmptyState, ErrorView, LoadingView, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  declineGroupInvite,
  type EventSummary,
  groupDetails,
  type GroupDetails,
  type GroupMember,
  joinGroup,
  leaveGroup,
  listEvents,
  listGroupMembers,
  listPosts,
  type Post,
  removeGroupMember,
  respondJoinRequest,
  setGroupRole,
} from '@/lib/community';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/providers/auth-provider';

type Tab = 'posts' | 'members' | 'events' | 'requests';

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const [group, setGroup] = useState<GroupDetails | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('posts');
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const g = await groupDetails(id);
      setGroup(g);
      setError(null);
      if (!g) return;
      const isMember = g.my_status === 'active';
      if (tab === 'posts') setPosts(await listPosts('group', id));
      if (tab === 'members' && isMember) setMembers(await listGroupMembers(id));
      if (tab === 'requests' && isMember) setMembers(await listGroupMembers(id, 'requested'));
      if (tab === 'events') setEvents(await listEvents('group', { groupId: id }));
    } catch (e) {
      setError(e);
    }
  }, [id, tab]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && group === undefined) return <ErrorView message={friendlyError(error)} onRetry={load} />;
  if (group === undefined) return <LoadingView />;
  if (group === null) return <ErrorView message="This group isn't available. It may be private or deleted." />;

  const role = group.my_status === 'active' ? group.my_role : null;
  const isAdmin = role === 'owner' || role === 'admin';
  const canModerate = isAdmin || role === 'moderator';

  function confirmLeave() {
    Alert.alert(
      `Leave ${group!.name}?`,
      role === 'owner' ? 'Ownership passes to an admin or the longest-standing member. If you are the only member, the group is deleted.' : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => act(() => leaveGroup(id)) },
      ],
    );
  }

  function memberMenu(m: GroupMember) {
    if (m.user_id === me) return;
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [
      { text: 'View profile', onPress: () => router.push({ pathname: '/profile/[id]', params: { id: m.user_id } }) },
    ];
    if (role === 'owner' && m.role !== 'owner') {
      for (const r of ['admin', 'moderator', 'member'] as const) {
        if (r !== m.role) options.push({ text: `Make ${r}`, onPress: () => act(() => setGroupRole(id, m.user_id, r)) });
      }
    }
    const canRemove = m.role !== 'owner' && (role === 'owner' || (role === 'admin' && m.role !== 'admin') || (role === 'moderator' && m.role === 'member'));
    if (canRemove) {
      options.push({ text: 'Remove from group', style: 'destructive', onPress: () => act(() => removeGroupMember(id, m.user_id)) });
      if (isAdmin) options.push({ text: 'Remove and ban', style: 'destructive', onPress: () => act(() => removeGroupMember(id, m.user_id, true)) });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(m.display_name, undefined, options);
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: 'posts', label: 'Posts' },
    ...(role ? [{ value: 'members' as Tab, label: `Members (${group.member_count})` }] : []),
    { value: 'events', label: 'Events' },
    ...(isAdmin && group.privacy === 'approval' ? [{ value: 'requests' as Tab, label: `Requests (${group.pending_requests ?? 0})` }] : []),
  ];

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: group.name }} />
      <AppText variant="title">{group.name}</AppText>
      <AppText variant="caption" muted>
        {[PRIVACY_LABEL[group.privacy], `${group.member_count} member${group.member_count === 1 ? '' : 's'}`, group.region || null]
          .filter(Boolean)
          .join(' · ')}
      </AppText>
      {group.description ? <AppText>{group.description}</AppText> : null}
      {actionError ? <Banner message={actionError} /> : null}

      {group.my_status === 'invited' ? (
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Accept invitation" loading={busy} onPress={() => act(() => joinGroup(id))} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Decline" variant="secondary" onPress={() => act(async () => { await declineGroupInvite(id); router.back(); })} />
          </View>
        </View>
      ) : group.my_status === 'requested' ? (
        <Button title="Request sent · Cancel" variant="secondary" loading={busy} onPress={() => act(() => leaveGroup(id))} />
      ) : !role ? (
        <Button
          title={group.privacy === 'approval' ? 'Ask to join' : 'Join group'}
          icon="enter-outline"
          loading={busy}
          onPress={() => act(() => joinGroup(id))}
        />
      ) : (
        <View style={{ gap: Spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {group.conversation_id ? (
              <View style={{ flex: 1 }}>
                <Button
                  title="Group chat"
                  icon="chatbubbles-outline"
                  onPress={() => router.push({ pathname: '/chat/[id]', params: { id: group.conversation_id! } })}
                />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Button title="Post" icon="create-outline" variant="secondary" onPress={() => router.push({ pathname: '/compose-post', params: { group: id } })} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {group.privacy !== 'private' || isAdmin ? (
              <View style={{ flex: 1 }}>
                <Button title="Invite" icon="person-add-outline" variant="secondary" onPress={() => router.push({ pathname: '/invite', params: { kind: 'group', id } })} />
              </View>
            ) : null}
            {isAdmin ? (
              <View style={{ flex: 1 }}>
                <Button title="Edit" icon="settings-outline" variant="secondary" onPress={() => router.push({ pathname: '/group-form', params: { id } })} />
              </View>
            ) : null}
          </View>
        </View>
      )}

      <ChoiceChips options={tabs} value={tab} onChange={setTab} />

      {tab === 'posts' ? (
        posts === null ? (
          <LoadingView />
        ) : posts.length === 0 ? (
          <EmptyState
            icon="newspaper-outline"
            title="No posts yet"
            message={role ? 'Be the first to post in this group.' : group.privacy === 'public' ? 'Nothing posted yet.' : 'Posts are visible to members.'}
          />
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              me={me}
              canModerate={canModerate}
              onChanged={(np) => setPosts((prev) => prev?.map((x) => (x.id === np.id ? np : x)) ?? null)}
              onDeleted={(pid) => setPosts((prev) => prev?.filter((x) => x.id !== pid) ?? null)}
            />
          ))
        )
      ) : null}

      {tab === 'members' ? (
        members === null ? (
          <LoadingView />
        ) : (
          members.map((m) => (
            <View key={m.user_id} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <PersonRow person={{ ...m, id: m.user_id }} detail={m.role === 'member' ? null : m.role[0].toUpperCase() + m.role.slice(1)} />
              </View>
              {canModerate && m.user_id !== me ? <Button title="Manage" variant="ghost" onPress={() => memberMenu(m)} /> : null}
            </View>
          ))
        )
      ) : null}

      {tab === 'requests' ? (
        members === null ? (
          <LoadingView />
        ) : members.length === 0 ? (
          <AppText muted>No pending requests.</AppText>
        ) : (
          members.map((m) => (
            <View key={m.user_id} style={{ gap: Spacing.xs }}>
              <PersonRow person={{ ...m, id: m.user_id }} />
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Approve" onPress={() => act(() => respondJoinRequest(id, m.user_id, true))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Decline" variant="secondary" onPress={() => act(() => respondJoinRequest(id, m.user_id, false))} />
                </View>
              </View>
            </View>
          ))
        )
      ) : null}

      {tab === 'events' ? (
        <View style={{ gap: Spacing.sm }}>
          {role ? (
            <Button title="Create group event" icon="calendar-outline" variant="secondary" onPress={() => router.push({ pathname: '/event-form', params: { group: id } })} />
          ) : null}
          {events === null ? (
            <LoadingView />
          ) : events.length === 0 ? (
            <AppText muted>No upcoming events.</AppText>
          ) : (
            events.map((e) => <EventRow key={e.id} event={e} />)
          )}
        </View>
      ) : null}

      {role ? <Button title="Leave group" variant="danger" icon="exit-outline" onPress={confirmLeave} /> : null}
    </Screen>
  );
}
