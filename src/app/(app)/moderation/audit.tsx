// Audit log (admins only; the database refuses everyone else).
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { AppText, Button, Divider, ErrorView, LoadingView, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { friendlyError } from '@/lib/errors';
import { type AuditEntry, auditLog } from '@/lib/moderation';

export default function Audit() {
  const load = useCallback(() => auditLog(), []);
  const { data, error, reload } = useAsync(load);
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [end, setEnd] = useState(false);

  if (error && !data) return <ErrorView message={friendlyError(error)} onRetry={reload} />;
  if (!data) return <LoadingView />;
  const entries = [...data, ...more];

  async function loadMore() {
    setLoading(true);
    try {
      const page = await auditLog(entries[entries.length - 1]?.id);
      setMore((m) => [...m, ...page]);
      if (page.length < 100) setEnd(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      {entries.length === 0 ? <AppText muted>No entries yet.</AppText> : null}
      {entries.map((e) => (
        <View key={e.id} style={{ gap: 2 }}>
          <AppText style={{ fontWeight: '600' }}>{e.action.replace(/_/g, ' ')}</AppText>
          <AppText variant="caption" muted>
            {new Date(e.created_at).toLocaleString()} · @{e.actor_username ?? 'system'} · {e.target_type} {e.target_id}
          </AppText>
          {Object.keys(e.details ?? {}).length ? (
            <AppText variant="caption" selectable>
              {JSON.stringify(e.details)}
            </AppText>
          ) : null}
          <Divider />
        </View>
      ))}
      {entries.length >= 100 && !end ? <Button title="Older entries" variant="secondary" loading={loading} onPress={loadMore} /> : null}
      <View style={{ height: Spacing.lg }} />
    </Screen>
  );
}
