// Moderation queue. The database refuses these calls for non-moderators.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Banner, Button, Card, ChoiceChips, EmptyState, LoadingView, Screen } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/format';
import { listReports, type QueueReport, REASON_LABEL } from '@/lib/moderation';

type Filter = 'open' | 'actioned' | 'dismissed';
const URGENT = new Set(['self_harm', 'underage', 'violence']);

export default function ModerationQueue() {
  const c = useTheme();
  const [filter, setFilter] = useState<Filter>('open');
  const [reports, setReports] = useState<QueueReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReports(await listReports(filter));
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen edges={['bottom']}>
      <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="Find a member" variant="secondary" icon="search" onPress={() => router.push('/moderation/users')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Audit log" variant="secondary" icon="list-outline" onPress={() => router.push('/moderation/audit')} />
        </View>
      </View>
      <ChoiceChips
        options={[
          { value: 'open', label: 'Open' },
          { value: 'actioned', label: 'Actioned' },
          { value: 'dismissed', label: 'Dismissed' },
        ]}
        value={filter}
        onChange={(f) => {
          setReports(null);
          setFilter(f);
        }}
      />
      {error ? <Banner message={error} action={<Button title="Retry" variant="ghost" onPress={load} />} /> : null}
      {reports === null && !error ? <LoadingView /> : null}
      {reports?.length === 0 ? <EmptyState icon="checkmark-done-outline" title="Nothing here" message="No reports in this list." /> : null}
      {reports?.map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/moderation/report/[id]', params: { id: String(r.id) } })}>
          <Card style={URGENT.has(r.reason) && filter === 'open' ? { borderColor: c.danger, borderWidth: 2 } : undefined}>
            <AppText style={{ fontWeight: '600' }}>
              {REASON_LABEL[r.reason]} · {r.target_type}
              {r.status === 'reviewing' ? ' · in review' : ''}
            </AppText>
            <AppText variant="caption" muted numberOfLines={1}>
              {r.target_display_name ? `${r.target_display_name} (@${r.target_username})` : 'Unknown member'} · {timeAgo(r.created_at)}
              {r.reports_on_target > 1 ? ` · reported ${r.reports_on_target}×` : ''}
            </AppText>
            <AppText numberOfLines={2}>{snapshotPreview(r)}</AppText>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

export function snapshotPreview(r: QueueReport): string {
  const s = r.snapshot as Record<string, string | undefined>;
  return s.body || s.title || s.name || s.bio || s.display_name || (s.kind === 'image' ? '[photo]' : '');
}
