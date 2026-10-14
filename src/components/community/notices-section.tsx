import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText, Banner, Button, Card, Chip, EmptyState, LoadingView, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { startDirectConversation } from '@/lib/chat';
import { deleteNotice, listNotices, type Notice, NOTICE_CATEGORIES, type NoticeCategory } from '@/lib/community';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/format';

const CATEGORY_LABEL = Object.fromEntries(NOTICE_CATEGORIES.map((c) => [c.value, c.label])) as Record<NoticeCategory, string>;

export function NoticesSection() {
  const [category, setCategory] = useState<NoticeCategory | null>(null);
  const [region, setRegion] = useState('');
  const [query, setQuery] = useState('');
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotices(await listNotices({ category, region, query }));
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [category, region, query]);

  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(load, 250);
      return () => clearTimeout(t);
    }, [load]),
  );

  async function contact(n: Notice) {
    setError(null);
    try {
      const id = await startDirectConversation(n.author_id);
      router.push({ pathname: '/chat/[id]', params: { id } });
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  function remove(n: Notice) {
    Alert.alert('Delete this notice?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNotice(n.id);
            setNotices((prev) => prev?.filter((x) => x.id !== n.id) ?? null);
          } catch (e) {
            setError(friendlyError(e));
          }
        },
      },
    ]);
  }

  return (
    <View style={{ gap: Spacing.md }}>
      <Button title="Post a notice" icon="megaphone-outline" onPress={() => router.push('/notice-form')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
        <Chip label="All" selected={category === null} onPress={() => setCategory(null)} radio />
        {NOTICE_CATEGORIES.map((c) => (
          <Chip key={c.value} label={c.label} selected={category === c.value} onPress={() => setCategory(c.value)} radio />
        ))}
      </View>
      <TextField label="Town or region" value={region} onChangeText={setRegion} placeholder="All places" />
      <TextField label="Search notices" value={query} onChangeText={setQuery} placeholder="e.g. room, ride to airport" />
      {error ? <Banner message={error} /> : null}
      {notices === null && !error ? <LoadingView /> : null}
      {notices?.length === 0 ? (
        <EmptyState icon="clipboard-outline" title="No notices" message="Notices expire automatically. Post one to ask or offer something." />
      ) : null}
      {notices?.map((n) => (
        <Card key={n.id}>
          <AppText variant="caption" muted>
            {CATEGORY_LABEL[n.category]} · {n.region} · {timeAgo(n.created_at)}
          </AppText>
          <AppText style={{ fontWeight: '600' }}>{n.title}</AppText>
          <AppText selectable>{n.body}</AppText>
          <AppText variant="caption" muted>
            Posted by {n.author_name} (@{n.author_username}) · expires {new Date(n.expires_at).toLocaleDateString()}
          </AppText>
          {n.is_mine ? (
            <Button title="Delete notice" variant="ghost" icon="trash-outline" onPress={() => remove(n)} />
          ) : (
            <>
              <Button title={`Message ${n.author_name}`} variant="secondary" icon="chatbubble-outline" onPress={() => contact(n)} />
              <Button
                title="Report notice"
                variant="ghost"
                icon="flag-outline"
                onPress={() => router.push({ pathname: '/report', params: { type: 'notice', id: n.id, name: n.author_name, user: n.author_id } })}
              />
            </>
          )}
        </Card>
      ))}
      <AppText variant="caption" muted>
        NearMalayali doesn't handle payments. Meet in public places and never send money to someone you haven't met.
      </AppText>
    </View>
  );
}
