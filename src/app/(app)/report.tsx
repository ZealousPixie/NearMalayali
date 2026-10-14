// Report something to the moderators: ?type=post&id=<id>&name=<label>&user=<author id>
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Chip, EmptyState, Screen, TextField, ToggleRow } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { blockUser } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { REPORT_REASONS, type ReportReason, reportContent, type ReportTarget } from '@/lib/moderation';

const WHAT: Record<ReportTarget, string> = {
  profile: 'this profile',
  post: 'this post',
  comment: 'this comment',
  message: 'this message',
  group: 'this group',
  event: 'this event',
  notice: 'this notice',
};

export default function Report() {
  const { type, id, name, user } = useLocalSearchParams<{ type: ReportTarget; id: string; name?: string; user?: string }>();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await reportContent(type, id, reason, details.trim());
      if (alsoBlock && user) await blockUser(user);
      setDone(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="shield-checkmark-outline"
          title="Thanks for reporting"
          message={`Moderators will review it. ${name ? `${name} isn't` : 'The other person isn\'t'} told who reported. You can follow the outcome in Settings › My reports.${alsoBlock ? ' You have also blocked them.' : ''}`}
          action={<Button title="Done" onPress={() => (alsoBlock ? router.dismissAll() : router.back())} />}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <AppText variant="subtitle">What's wrong with {WHAT[type] ?? 'this'}?</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
        {REPORT_REASONS.map((r) => (
          <Chip key={r.value} label={r.label} radio selected={reason === r.value} onPress={() => setReason(r.value)} />
        ))}
      </View>
      {reason === 'self_harm' ? (
        <Banner
          tone="warning"
          message="If someone is in immediate danger, call your local emergency number now. Moderators review reports but can't send help."
        />
      ) : null}
      <TextField
        label="Anything else moderators should know? (optional)"
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={1000}
        style={{ minHeight: 100, textAlignVertical: 'top' }}
      />
      {user ? (
        <ToggleRow
          label={`Also block ${name ?? 'them'}`}
          description="You won't see each other anywhere in NearMalayali."
          value={alsoBlock}
          onChange={setAlsoBlock}
        />
      ) : null}
      {error ? <Banner message={error} /> : null}
      <Button title="Send report" icon="flag-outline" variant="danger" loading={busy} disabled={!reason} onPress={submit} />
      <AppText variant="caption" muted>
        {type === 'message'
          ? 'Moderators see only the message you report, not the rest of your conversation.'
          : 'A copy of what you report is kept for moderators, even if it is later deleted.'}
      </AppText>
    </Screen>
  );
}
