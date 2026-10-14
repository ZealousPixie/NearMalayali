// Step 2: optional profile details and photo.
import { router } from 'expo-router';

import { ProfileForm } from '@/components/profile-form';
import { AppText, Button, Screen } from '@/components/ui';
import { useOnboardingDraft } from '@/providers/onboarding-draft';

export default function OnboardingAbout() {
  const { draft } = useOnboardingDraft();
  return (
    <Screen edges={['bottom']}>
      <AppText variant="title">Tell people about yourself</AppText>
      <AppText muted>Everything here is optional and you can change it any time.</AppText>
      <ProfileForm
        submitLabel="Save and continue"
        displayNameForAvatar={draft.displayName || 'You'}
        onSaved={() => router.push('/finish')}
      />
      <Button title="Skip for now" variant="ghost" onPress={() => router.push('/finish')} />
    </Screen>
  );
}
