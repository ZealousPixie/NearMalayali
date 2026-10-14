import { useState } from 'react';

import { AppText, Banner, Button, Card, Divider, ErrorView, LoadingView, Screen, ToggleRow } from '@/components/ui';
import { useSettings } from '@/hooks/use-settings';
import { fetchNotificationPreferences, updateNotificationPreferences } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { registerForPush } from '@/lib/push';
import type { NotificationPreferences } from '@/lib/types';

const CATEGORIES: { key: keyof NotificationPreferences; label: string }[] = [
  { key: 'proximity', label: 'A fellow Malayali is nearby' },
  { key: 'connection_requests', label: 'Connection requests' },
  { key: 'connection_accepted', label: 'Accepted connections' },
  { key: 'messages', label: 'Messages' },
  { key: 'follows', label: 'New followers' },
  { key: 'reactions_comments', label: 'Reactions and comments' },
  { key: 'group_invites', label: 'Group invitations' },
  { key: 'group_activity', label: 'Group activity' },
  { key: 'event_invites', label: 'Event invitations' },
  { key: 'event_reminders', label: 'Event reminders' },
  { key: 'security', label: 'Account security' },
];

export default function NotificationSettings() {
  const { value, loadError, saveError, reload, update } = useSettings(fetchNotificationPreferences, updateNotificationPreferences);

  if (loadError) return <ErrorView message={friendlyError(loadError)} onRetry={reload} />;
  if (!value) return <LoadingView />;

  return (
    <Screen edges={['bottom']}>
      {saveError ? <Banner message={saveError} /> : null}
      <PushStatus />
      <Card>
        <ToggleRow
          label="Push notifications"
          description="Master switch for notifications on this account."
          value={value.push_enabled}
          onChange={(v) => update({ push_enabled: v })}
        />
        <Divider />
        <ToggleRow
          label="Show message previews"
          description="Off keeps message text and names off your lock screen."
          value={value.show_previews}
          onChange={(v) => update({ show_previews: v })}
        />
      </Card>
      <Card>
        <AppText variant="label" muted>
          Notify me about
        </AppText>
        {CATEGORIES.map((cat, i) => (
          <ToggleRowWithDivider
            key={cat.key}
            first={i === 0}
            label={cat.label}
            value={value[cat.key] as boolean}
            disabled={!value.push_enabled}
            onChange={(v) => update({ [cat.key]: v } as Partial<NotificationPreferences>)}
          />
        ))}
        <AppText variant="caption" muted>
          Security notices always appear in the app; this only controls push.
        </AppText>
      </Card>
    </Screen>
  );
}

function PushStatus() {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | string>('idle');
  async function enable() {
    setState('busy');
    const r = await registerForPush(true);
    setState(
      r.ok
        ? 'ok'
        : r.reason === 'PERMISSION_DENIED'
          ? 'Notifications are blocked for NearMalayali in your phone settings.'
          : r.reason === 'NOT_A_DEVICE'
            ? 'Push notifications only work on a real phone.'
            : r.reason === 'NO_PROJECT_ID'
              ? 'This build is missing its EAS project ID, so push can\'t be set up.'
              : 'Push setup failed. Please try again later.',
    );
  }
  return (
    <Card>
      <AppText muted>Notifications always appear in the app's notification centre. Push shows them on your phone too.</AppText>
      {state === 'ok' ? <Banner tone="success" message="This phone is set up for push notifications." /> : null}
      {state !== 'idle' && state !== 'busy' && state !== 'ok' ? <Banner tone="warning" message={state} /> : null}
      {state !== 'ok' ? <Button title="Allow push on this phone" variant="secondary" onPress={enable} loading={state === 'busy'} /> : null}
    </Card>
  );
}

function ToggleRowWithDivider(props: { first: boolean; label: string; value: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const { first, ...rest } = props;
  return (
    <>
      {first ? null : <Divider />}
      <ToggleRow {...rest} />
    </>
  );
}
