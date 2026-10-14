import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Banner, Button, Card, EmptyState, LoadingView, TextField } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { type GroupSummary, listGroups } from '@/lib/community';
import { friendlyError } from '@/lib/errors';

export const PRIVACY_LABEL = { public: 'Public', approval: 'Approval needed', private: 'Private' } as const;

export function GroupsSection() {
  const [mine, setMine] = useState<GroupSummary[] | null>(null);
  const [discover, setDiscover] = useState<GroupSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    try {
      setMine(await listGroups('mine'));
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMine();
    }, [loadMine]),
  );

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      listGroups('discover', query).then(
        (g) => active && setDiscover(g),
        (e) => active && setError(friendlyError(e)),
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const mineIds = new Set(mine?.map((g) => g.id));

  return (
    <View style={{ gap: Spacing.md }}>
      <Button title="Create a group" icon="add-circle-outline" onPress={() => router.push('/group-form')} />
      {error ? <Banner message={error} /> : null}
      <AppText variant="subtitle">Your groups</AppText>
      {mine === null ? <LoadingView /> : mine.length === 0 ? <AppText muted>You haven't joined any groups yet.</AppText> : null}
      {mine?.map((g) => <GroupRow key={g.id} group={g} />)}
      <AppText variant="subtitle">Find groups</AppText>
      <TextField label="Search by name or town" value={query} onChangeText={setQuery} placeholder="e.g. Perth, cricket, Thrissur" />
      {discover === null ? (
        <LoadingView />
      ) : discover.filter((g) => !mineIds.has(g.id)).length === 0 ? (
        <EmptyState icon="people-circle-outline" title="No groups found" message="Try another search, or start the group yourself." />
      ) : (
        discover.filter((g) => !mineIds.has(g.id)).map((g) => <GroupRow key={g.id} group={g} />)
      )}
    </View>
  );
}

function GroupRow({ group: g }: { group: GroupSummary }) {
  const c = useTheme();
  const status =
    g.my_status === 'invited' ? 'Invited' : g.my_status === 'requested' ? 'Request sent' : g.my_role && g.my_role !== 'member' ? g.my_role[0].toUpperCase() + g.my_role.slice(1) : null;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/group/[id]', params: { id: g.id } })}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
        <Ionicons name={g.privacy === 'private' ? 'lock-closed' : 'people'} size={24} color={c.primary} />
        <View style={{ flex: 1 }}>
          <AppText style={{ fontWeight: '600' }} numberOfLines={1}>
            {g.name}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {[`${g.member_count} member${g.member_count === 1 ? '' : 's'}`, PRIVACY_LABEL[g.privacy], g.region || null, status]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
      </Card>
    </Pressable>
  );
}
