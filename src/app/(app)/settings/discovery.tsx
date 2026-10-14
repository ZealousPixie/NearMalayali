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
  const { value, loadError, saveError, saving, reload, update } = useSettings(fetchDiscoverySettings, updateDiscoverySettings);

  if (loadError) return <ErrorView message={friendlyError(loadError)} onRetry={reload} />;
  if (!value) return <LoadingView />;

  const pausedUntil = value.paused_until ? new Date(value.paused_until) : null;
  const paused = !!pausedUntil && pausedUntil > new Date();

  return (
    <Screen edges={['bottom']}>
      {saveError ? <Banner message={saveError} /> : null}
      <Banner
        tone="info"
        message="Location sharing is not active in this build yet. These choices are saved and enforced by the server, and will apply as soon as nearby discovery ships."
      />

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
