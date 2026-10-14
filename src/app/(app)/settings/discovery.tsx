import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  ChoiceChips,
  Divider,
  ErrorView,
  LoadingView,
  Screen,
  ToggleRow,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSettings } from '@/hooks/use-settings';
import { fetchDiscoverySettings, updateDiscoverySettings } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatDistance } from '@/lib/format';
import { getPermissionState, syncBackgroundTracking } from '@/lib/location';
import { registerForPush } from '@/lib/push';
import type { DiscoverySettings } from '@/lib/types';

const SEARCH_RADII = [100, 250, 500, 1000, 5000, 10000, 25000, 50000];
const ALERT_RADII = [100, 250, 500, 1000, 2000, 5000];
const COOLDOWNS = [1, 6, 12, 24, 72, 168];
const PAUSES: { label: string; hours: number }[] = [
  { label: '1 hour', hours: 1 },
  { label: '8 hours', hours: 8 },
  { label: '24 hours', hours: 24 },
  { label: '1 week', hours: 168 },
];

export default function DiscoverySettingsScreen() {
  const { value, loadError, saveError, saving, reload, update: save } = useSettings(fetchDiscoverySettings, updateDiscoverySettings);
  const [backgroundOk, setBackgroundOk] = useState<boolean | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);

  const syncTracking = useCallback(async (s: DiscoverySettings | null) => {
    if (!s) return;
    const paused = !!s.paused_until && new Date(s.paused_until) > new Date();
    const running = await syncBackgroundTracking({ wantsAlerts: s.discoverable && s.proximity_alerts && !paused }).catch(() => false);
    const perms = await getPermissionState();
    setBackgroundOk(running || !s.proximity_alerts ? true : perms.background === 'granted');
  }, []);

  // Re-check when returning from the permission screen.
  useFocusEffect(
    useCallback(() => {
      syncTracking(value);
    }, [syncTracking, value]),
  );

  async function update(patch: Partial<DiscoverySettings>) {
    if (!(await save(patch)) || !value) return;
    const next = { ...value, ...patch };
    if (patch.proximity_alerts === true) {
      const perms = await getPermissionState();
      if (perms.background !== 'granted') {
        router.push({ pathname: '/location-permission', params: { purpose: 'alerts' } });
      }
      const push = await registerForPush(true);
      setPushNote(
        push.ok
          ? null
          : push.reason === 'PERMISSION_DENIED'
            ? 'Notifications are turned off for NearMalayali, so alerts will only appear inside the app. You can allow them in your phone\'s settings.'
            : push.reason === 'NOT_A_DEVICE'
              ? 'Push notifications need a real phone; alerts will appear inside the app.'
              : 'We couldn\'t set up push notifications right now; alerts will appear inside the app.',
      );
    }
    await syncTracking(next);
  }

  if (loadError) return <ErrorView message={friendlyError(loadError)} onRetry={reload} />;
  if (!value) return <LoadingView />;

  const pausedUntil = value.paused_until ? new Date(value.paused_until) : null;
  const paused = !!pausedUntil && pausedUntil > new Date();

  return (
    <Screen edges={['bottom']}>
      {saveError ? <Banner message={saveError} /> : null}
      {value.proximity_alerts && backgroundOk === false ? (
        <Banner
          tone="warning"
          message="Proximity alerts need background location access, which isn't allowed yet. You'll still appear to others and see nearby lists while the app is open."
          action={<Button title="Allow background location" variant="secondary" onPress={() => router.push({ pathname: '/location-permission', params: { purpose: 'alerts' } })} />}
        />
      ) : null}
      {pushNote ? <Banner tone="warning" message={pushNote} /> : null}

      <Card>
        <ToggleRow
          label="Let nearby Malayalis discover me"
          description="Off by default. When off, you never appear in nearby lists, the map or alerts, and any stored location is deleted immediately."
          value={value.discoverable}
          onChange={(v) =>
            update(v ? { discoverable: true } : { discoverable: false, map_visible: false, proximity_alerts: false })
          }
          disabled={saving}
        />
        <Divider />
        <ToggleRow
          label="Show me on the community map"
          description="Only as part of an approximate area with at least 3 people, never as a pin."
          value={value.map_visible}
          onChange={(v) => update({ map_visible: v })}
          disabled={!value.discoverable || saving}
        />
        <Divider />
        <ToggleRow
          label="Proximity alerts"
          description="Get a notification when another member who also turned this on is close by. Alerts never reveal who or exactly where."
          value={value.proximity_alerts}
          onChange={(v) => update({ proximity_alerts: v })}
          disabled={!value.discoverable || saving}
        />
      </Card>

      <Card>
        <AppText variant="label" muted>
          Temporary invisibility
        </AppText>
        {paused ? (
          <View style={{ gap: Spacing.sm }}>
            <AppText>Hidden from discovery until {pausedUntil!.toLocaleString()}.</AppText>
            <Button title="Resume now" variant="secondary" onPress={() => update({ paused_until: null })} />
          </View>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            <AppText muted>Hide from nearby lists, the map and alerts for a while. Your stored location is deleted.</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              {PAUSES.map((p) => (
                <Button
                  key={p.hours}
                  title={p.label}
                  variant="secondary"
                  onPress={() => update({ paused_until: new Date(Date.now() + p.hours * 3600_000).toISOString() })}
                />
              ))}
            </View>
          </View>
        )}
      </Card>

      <Card>
        <ChoiceChips
          label="Default search radius"
          options={SEARCH_RADII.map((r) => ({ value: r, label: formatDistance(r) }))}
          value={value.discovery_radius_m}
          onChange={(v) => update({ discovery_radius_m: v })}
        />
        <Divider />
        <ChoiceChips
          label="Alert me when someone is within"
          options={ALERT_RADII.map((r) => ({ value: r, label: formatDistance(r) }))}
          value={value.alert_radius_m}
          onChange={(v) => update({ alert_radius_m: v })}
          disabled={!value.proximity_alerts}
        />
        <AppText variant="caption" muted>
          Both people must be within the smaller of their two chosen distances. Phone GPS can be off by tens of metres, so very
          small distances are less reliable.
        </AppText>
        <Divider />
        <ChoiceChips
          label="Don't alert me about the same person again for"
          options={COOLDOWNS.map((h) => ({ value: h, label: h < 24 ? `${h} h` : `${h / 24} d` }))}
          value={value.alert_cooldown_hours}
          onChange={(v) => update({ alert_cooldown_hours: v })}
          disabled={!value.proximity_alerts}
        />
      </Card>
    </Screen>
  );
}
