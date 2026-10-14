// Onboarding collects basics first, lets people fill in their profile, and
// only calls complete_onboarding() on the last step (that call flips the
// account into the main app).
import { Stack } from 'expo-router';

import { useTheme } from '@/constants/theme';
import { OnboardingDraftProvider } from '@/providers/onboarding-draft';

export default function OnboardingLayout() {
  const c = useTheme();
  return (
    <OnboardingDraftProvider>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: c.primary,
          headerStyle: { backgroundColor: c.background },
          contentStyle: { backgroundColor: c.background },
        }}>
        <Stack.Screen name="index" options={{ title: 'Step 1 of 3' }} />
        <Stack.Screen name="about" options={{ title: 'Step 2 of 3' }} />
        <Stack.Screen name="finish" options={{ title: 'Step 3 of 3' }} />
      </Stack>
    </OnboardingDraftProvider>
  );
}
