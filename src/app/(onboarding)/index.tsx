// Step 1: username, display name and date of birth (age check).
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { usernameAvailable } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { displayNameSchema, firstError, isEligibleAge, USERNAME_RE, usernameSchema } from '@/lib/validation';
import { useAuth } from '@/providers/auth-provider';
import { useOnboardingDraft } from '@/providers/onboarding-draft';

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'error';

export default function OnboardingBasics() {
  const c = useTheme();
  const { signOut } = useAuth();
  const { draft, setDraft } = useOnboardingDraft();
  const [username, setUsername] = useState(draft.username);
  const [displayName, setDisplayName] = useState(draft.displayName);
  const [dob, setDob] = useState<Date | null>(draft.dateOfBirth);
  const [showPicker, setShowPicker] = useState(false);
  const [availability, setAvailability] = useState<Availability>('idle');
  const [errors, setErrors] = useState<{ username?: string | null; displayName?: string | null; dob?: string | null }>({});
  const [ineligible, setIneligible] = useState(false);

  // Debounced availability check.
  useEffect(() => {
    const value = username.trim().toLowerCase().replace(/^@/, '');
    if (!USERNAME_RE.test(value)) {
      setAvailability('idle');
      return;
    }
    setAvailability('checking');
    const t = setTimeout(async () => {
      try {
        setAvailability((await usernameAvailable(value)) ? 'available' : 'taken');
      } catch {
        setAvailability('error');
      }
    }, 500);
    return () => clearTimeout(t);
  }, [username]);

  function onDateChange(e: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === 'android') setShowPicker(false);
    if (e.type === 'set' && date) setDob(date);
  }

  function next() {
    const next = {
      username: firstError(usernameSchema, username) ?? (availability === 'taken' ? 'That username is already taken.' : null),
      displayName: firstError(displayNameSchema, displayName),
      dob: dob ? null : 'Enter your date of birth.',
    };
    setErrors(next);
    if (next.username || next.displayName || next.dob || !dob) return;
    if (!isEligibleAge(dob)) {
      setIneligible(true);
      return;
    }
    setDraft({ username: usernameSchema.parse(username), displayName: displayName.trim(), dateOfBirth: dob });
    router.push('/about');
  }

  if (ineligible) {
    return (
      <Screen edges={['bottom']}>
        <AppText variant="title">Sorry, you need to be 18 or over</AppText>
        <AppText muted>
          NearMalayali helps adults meet in person, so accounts are limited to people aged 18 and over. Your date of birth
          hasn't been saved.
        </AppText>
        <Button title="Sign out" onPress={signOut} />
      </Screen>
    );
  }

  const hint =
    availability === 'checking'
      ? 'Checking…'
      : availability === 'available'
        ? '✓ Available'
        : availability === 'error'
          ? friendlyError('network error')
          : 'Letters, numbers and underscores. You can change it later.';

  return (
    <Screen edges={['bottom']}>
      <AppText variant="title">Let's set up your profile</AppText>
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="e.g. anu_perth"
        error={errors.username ?? (availability === 'taken' ? 'That username is already taken.' : null)}
        hint={hint}
      />
      <TextField
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        error={errors.displayName}
        placeholder="The name people will see"
        hint="It doesn't have to be your legal name."
        autoComplete="name"
      />
      <View style={{ gap: Spacing.xs }}>
        <AppText variant="caption" style={{ fontWeight: '600' }}>
          Date of birth
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose date of birth"
          onPress={() => setShowPicker(true)}
          style={{
            minHeight: 48,
            borderWidth: 1,
            borderColor: errors.dob ? c.danger : c.border,
            borderRadius: Radius.sm,
            paddingHorizontal: Spacing.md,
            justifyContent: 'center',
            backgroundColor: c.surface,
          }}>
          <AppText muted={!dob}>{dob ? dob.toLocaleDateString() : 'Choose date'}</AppText>
        </Pressable>
        {errors.dob ? (
          <AppText variant="caption" style={{ color: c.danger }}>
            {errors.dob}
          </AppText>
        ) : (
          <AppText variant="caption" muted>
            Used only to confirm you're 18 or over. It is never shown to anyone.
          </AppText>
        )}
        {showPicker ? (
          <DateTimePicker
            value={dob ?? new Date(1995, 0, 1)}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            minimumDate={new Date(1900, 0, 1)}
            onChange={onDateChange}
          />
        ) : null}
        {showPicker && Platform.OS === 'ios' ? <Button title="Done" variant="secondary" onPress={() => setShowPicker(false)} /> : null}
      </View>
      {availability === 'error' ? <Banner tone="warning" message="We couldn't check that username. We'll check again when you finish." /> : null}
      <Button title="Continue" onPress={next} />
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
