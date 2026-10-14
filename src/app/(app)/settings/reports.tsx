// Reports I've made and their outcome. Details of actions taken against
// other people aren't shown, to protect everyone's privacy.
import { useCallback } from 'react';

import { AppText, Card, EmptyState, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { friendlyError } from '@/lib/errors';
import { myReports, REASON_LABEL } from '@/lib/moderation';

const STATUS: Record<string, string> = {
  open: 'Waiting for review',
  reviewing: 'Being reviewed',
  actioned: 'Action taken',
  dismissed: 'Reviewed: no rule broken',
};

export default function MyReports() {
  const load = useCallback(() => myReports(), []);
  const { data, error, reload } = useAsync(load);
  if (error && !data) return <ErrorView message={friendlyError(error)} onRetry={reload} />;
  if (!data) return <LoadingView />;
  return (
    <Screen edges={['bottom']}>
      {data.length === 0 ? (
        <EmptyState icon="flag-outline" title="No reports" message="If something breaks the community guidelines, use Report on it." />
      ) : (
        data.map((r) => (
          <Card key={r.id}>
            <AppText style={{ fontWeight: '600' }}>
              {r.target_type[0].toUpperCase() + r.target_type.slice(1)} · {REASON_LABEL[r.reason]}
            </AppText>
            <AppText variant="caption" muted>
              Reported {new Date(r.created_at).toLocaleDateString()} · {STATUS[r.status]}
            </AppText>
          </Card>
        ))
      )}
    </Screen>
  );
}
