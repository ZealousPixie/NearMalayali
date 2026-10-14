// Step 3: explain privacy defaults, collect consent, create the profile.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Card, Checkbox, Screen } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { completeOnboarding } from '@/lib/api';
import { LEGAL_VERSIONS } from '@/lib/env';
import { friendlyError } from '@/lib/errors';
import { toIsoDate } from '@/lib/validation';
import { useAuth } from '@/providers/auth-provider';
import { useOnboardingDraft } from '@/providers/onboarding-draft';

const DEFAULTS = [
  'You are NOT discoverable nearby until you switch it on.',
  'Your location is not collected until you turn on discovery and allow location access.',
  'Nobody ever sees your exact location; distances are shown as rough ranges.',
  'You can pause or turn off discovery at any time.',
];

export default function OnboardingFinish() {
  const c = useTheme();
  const { draft } = useOnboardingDraft();
  const { refreshProfile } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish() {
    if (!draft.dateOfBirth || !draft.username) {
      router.replace('/');
      return;
    }
    if (!accepted) {
      setError('Please accept the terms, privacy policy and community guidelines.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding({
        username: draft.username,
        displayName: draft.displayName,
        dateOfBirth: toIsoDate(draft.dateOfBirth),
        termsVersion: LEGAL_VERSIONS.terms,
        privacyVersion: LEGAL_VERSIONS.privacy,
        guidelinesVersion: LEGAL_VERSIONS.guidelines,
      });
      // Reloading the profile moves the root layout into the main app.
      await refreshProfile();
    } catch (e) {
      setBusy(false);
      const msg = friendlyError(e);
      setError(msg);
    }
  }

  const usernameProblem = error?.toLowerCase().includes('username');

  return (
    <Screen edges={['bottom']}>
      <AppText variant="title">Your privacy comes first</AppText>
      <Card>
        {DEFAULTS.map((d) => (
          <View key={d} style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <Ionicons name="shield-checkmark" size={20} color={c.primary} />
            <AppText style={{ flex: 1 }}>{d}</AppText>
          </View>
        ))}
      </Card>
      <Checkbox checked={accepted} onChange={setAccepted}>
        <AppText>
          I am 18 or over and I accept the{' '}
          <Link href="/legal/terms" style={{ color: c.primary, fontWeight: '600' }}>
            Terms of Service
          </Link>
          ,{' '}
          <Link href="/legal/privacy" style={{ color: c.primary, fontWeight: '600' }}>
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link href="/legal/guidelines" style={{ color: c.primary, fontWeight: '600' }}>
            Community Guidelines
          </Link>
          .
        </AppText>
      </Checkbox>
      {error ? (
        <Banner
          message={error}
          action={usernameProblem ? <Button title="Change username" variant="secondary" onPress={() => router.dismissTo('/')} /> : undefined}
        />
      ) : null}
      <Button title="Create my profile" onPress={finish} loading={busy} />
    </Screen>
  );
}
