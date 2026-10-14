// One report: the captured content and the actions a moderator can take.
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText, Banner, Button, Card, ChoiceChips, ErrorView, LoadingView, Screen, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { friendlyError } from '@/lib/errors';
import { getReport, type QueueReport, REASON_LABEL, removeContent, reportedMediaUrl, resolveReport, suspendUser, warnUser } from '@/lib/moderation';

type Action = 'dismiss' | 'remove' | 'warn' | 'suspend';

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<QueueReport | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>('dismiss');
  const [note, setNote] = useState('');
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReport(await getReport(Number(id)));
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

  if (error && report === undefined) return <ErrorView message={friendlyError(error)} onRetry={load} />;
  if (report === undefined) return <LoadingView />;
  if (report === null) return <ErrorView message="This report doesn't exist." />;

  const open = report.status === 'open' || report.status === 'reviewing';
  const removable = report.target_type !== 'profile';
  const s = report.snapshot as Record<string, unknown>;

  async function apply() {
    const r = report!;
    if (action !== 'dismiss' && note.trim().length < 3) {
      setActionError('Write the reason the member will see (at least 3 characters).');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      if (action === 'dismiss') await resolveReport(r.id, 'dismissed', note);
      if (action === 'remove') await removeContent(r.target_type, r.target_id, note, r.id);
      if (action === 'warn' && r.target_user_id) await warnUser(r.target_user_id, note, r.id);
      if (action === 'suspend' && r.target_user_id) await suspendUser(r.target_user_id, days, note, r.id);
      router.back();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    const labels: Record<Action, string> = {
      dismiss: 'Dismiss this report?',
      remove: `Remove this ${report!.target_type}? The author is told why.`,
      warn: 'Send a warning? The member sees your reason.',
      suspend: `Suspend this member for ${days} day${days === 1 ? '' : 's'}? They are signed out of everything until then.`,
    };
    Alert.alert(labels[action], undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: action === 'dismiss' ? 'default' : 'destructive', onPress: apply },
    ]);
  }

  return (
    <Screen edges={['bottom']}>
      <AppText variant="subtitle">
        {REASON_LABEL[report.reason]} · {report.target_type}
      </AppText>
      <AppText variant="caption" muted>
        Reported by @{report.reporter_username ?? 'deleted account'} on {new Date(report.created_at).toLocaleString()} · status {report.status}
        {report.handled_by_username ? ` by @${report.handled_by_username}` : ''}
      </AppText>
      {report.details ? (
        <Card>
          <AppText variant="caption" muted>
            Reporter's note
          </AppText>
          <AppText>{report.details}</AppText>
        </Card>
      ) : null}
      <Card>
        <AppText variant="caption" muted>
          Captured when reported
        </AppText>
        {Object.entries(s)
          .filter(([k, v]) => typeof v === 'string' && v && !['attachment_path', 'avatar_path'].includes(k) && !k.endsWith('_id'))
          .map(([k, v]) => (
            <AppText key={k} selectable>
              <AppText style={{ fontWeight: '600' }}>{k.replace(/_/g, ' ')}: </AppText>
              {String(v)}
            </AppText>
          ))}
        {typeof s.attachment_path === 'string' ? <ReportedPhoto bucket="chat-media" path={s.attachment_path} /> : null}
        {Array.isArray(s.media) ? (s.media as string[]).map((p) => <ReportedPhoto key={p} bucket="post-media" path={p} />) : null}
      </Card>
      {report.target_user_id ? (
        <Button
          title={`@${report.target_username} · ${report.reports_on_user} report${report.reports_on_user === 1 ? '' : 's'} in total`}
          variant="secondary"
          icon="person-outline"
          onPress={() => router.push({ pathname: '/moderation/user/[id]', params: { id: report.target_user_id! } })}
        />
      ) : null}
      {report.resolution_note ? <AppText muted>Resolution: {report.resolution_note}</AppText> : null}

      {open ? (
        <View style={{ gap: Spacing.md }}>
          <ChoiceChips
            label="Action"
            options={[
              { value: 'dismiss' as Action, label: 'Dismiss' },
              ...(removable ? [{ value: 'remove' as Action, label: 'Remove content' }] : []),
              ...(report.target_user_id ? [{ value: 'warn' as Action, label: 'Warn' }, { value: 'suspend' as Action, label: 'Suspend' }] : []),
            ]}
            value={action}
            onChange={setAction}
          />
          {action === 'suspend' ? (
            <ChoiceChips
              label="Suspend for"
              options={[
                { value: 1 as const, label: '1 day' },
                { value: 7 as const, label: '7 days' },
                { value: 30 as const, label: '30 days' },
              ]}
              value={days}
              onChange={setDays}
            />
          ) : null}
          <TextField
            label={action === 'dismiss' ? 'Note (optional, internal)' : 'Reason (shown to the member)'}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={280}
          />
          {actionError ? <Banner message={actionError} /> : null}
          <Button title="Apply" variant={action === 'dismiss' ? 'primary' : 'danger'} loading={busy} onPress={confirm} />
          {report.status === 'open' ? (
            <Button title="Mark as in review" variant="ghost" onPress={() => resolveReport(report.id, 'reviewing').then(load, (e) => setActionError(friendlyError(e)))} />
          ) : null}
          <AppText variant="caption" muted>
            Indefinite suspensions and removing whole groups are for admins, from the member page. Removing content also closes the other reports on it.
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}

function ReportedPhoto({ bucket, path }: { bucket: 'chat-media' | 'post-media'; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    reportedMediaUrl(bucket, path).then(
      (u) => active && setUrl(u),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [bucket, path]);
  if (failed) return <AppText variant="caption" muted>Photo no longer available.</AppText>;
  return <Image source={url ? { uri: url } : undefined} style={{ width: '100%', aspectRatio: 1, borderRadius: Radius.sm }} contentFit="contain" accessibilityLabel="Reported photo" />;
}
