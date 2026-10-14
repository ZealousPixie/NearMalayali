// Explains location use BEFORE the system prompt appears, then asks.
// purpose=nearby asks for "while using the app"; purpose=alerts also asks
// for background access (needed only for proximity alerts).
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { AppText, Banner, Button, Card, Screen } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { getPermissionState, requestBackgroundPermission, requestForegroundPermission } from '@/lib/location';

const POINTS = [
  'Your exact location is never shown to anyone. Others see only rough distances like "under 1 km".',
  'We keep only your latest position, never a history, and delete it when you pause or turn discovery off.',
  'Browsing the map or another town never shares where you are.',
];

export default function LocationPermission() {
  const c = useTheme();
  const { purpose = 'nearby' } = useLocalSearchParams<{ purpose?: 'nearby' | 'alerts' }>();
  const [message, setMessage] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function allow() {
    setBusy(true);
    setMessage(null);
    try {
      const fg = await requestForegroundPermission();
      if (!fg) {
        const state = await getPermissionState();
        setBlocked(!state.canAskForeground);
        setMessage('Location access was not allowed, so nearby discovery can\'t work. Exploring other towns still works.');
        return;
      }
      if (purpose === 'alerts') {
        const bg = await requestBackgroundPermission();
        if (!bg) {
          const state = await getPermissionState();
          setBlocked(!state.canAskBackground);
          setMessage(
            Platform.OS === 'ios'
              ? 'Proximity alerts need "Always" location access. Nearby lists still work while the app is open.'
              : 'Proximity alerts need "Allow all the time" location access. Nearby lists still work while the app is open.',
          );
          return;
        }
      }
      router.back();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <View style={{ alignItems: 'center', gap: Spacing.md, marginTop: Spacing.lg }}>
        <Ionicons name={purpose === 'alerts' ? 'notifications-circle' : 'navigate-circle'} size={64} color={c.primary} />
        <AppText variant="title" style={{ textAlign: 'center' }}>
          {purpose === 'alerts' ? 'Alerts when Malayalis are nearby' : 'Find Malayalis near you'}
        </AppText>
      </View>
      <AppText muted>
        {purpose === 'alerts'
          ? 'To tell you when another member is close by, NearMalayali needs to check your location now and then while the app is closed. It only does this while proximity alerts are on, and only after you move a meaningful distance, to save battery.'
          : 'NearMalayali uses your location while the app is open to show who is around you.'}
      </AppText>
      <Card>
        {POINTS.map((p) => (
          <View key={p} style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <Ionicons name="shield-checkmark" size={20} color={c.primary} />
            <AppText style={{ flex: 1 }}>{p}</AppText>
          </View>
        ))}
      </Card>
      {purpose === 'alerts' ? (
        <AppText variant="caption" muted>
          {Platform.OS === 'ios'
            ? 'iOS will first ask about "While Using the App", then later offer "Change to Always Allow". Choose Always for alerts. If you force-quit the app, iOS stops background location until you open it again.'
            : 'Android will open settings: choose "Allow all the time". A small notification shows while alerts are on. Some phones (e.g. Xiaomi, Samsung, Huawei) stop background apps; allow NearMalayali to run in the background in battery settings.'}
        </AppText>
      ) : null}
      {message ? (
        <Banner
          tone="warning"
          message={message}
          action={blocked ? <Button title="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} /> : undefined}
        />
      ) : null}
      <Button title="Continue" onPress={allow} loading={busy} />
      <Button title="Not now" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
