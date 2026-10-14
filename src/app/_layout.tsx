import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppText, Card, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { env } from '@/lib/env';
import { friendlyError } from '@/lib/errors';
import { AuthProvider, useAuth } from '@/providers/auth-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const c = useTheme();
  const { initializing, session, profile, profileError, refreshProfile, recoveryInProgress } = useAuth();

  useEffect(() => {
    if (!initializing) SplashScreen.hideAsync();
  }, [initializing]);

  if (!env.isConfigured) return <SetupRequired />;
  if (initializing) return <LoadingView label="Starting NearMalayali…" />;
  if (session && !profile && !recoveryInProgress) {
    return profileError ? (
      <ErrorView message={friendlyError(profileError)} onRetry={refreshProfile} />
    ) : (
      <LoadingView label="Loading your profile…" />
    );
  }

  const signedIn = !!session && !recoveryInProgress;
  const active = profile?.account_status === 'active';
  const onboarded = !!profile?.onboarding_completed_at;

  // Each group is only reachable in the right state, so a signed-out person
  // can never land on an app screen and vice versa.
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !active}>
        <Stack.Screen name="account-inactive" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && active && !onboarded}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && active && onboarded}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Screen name="legal/[doc]" options={{ headerShown: true, title: '' }} />
    </Stack>
  );
}

function SetupRequired() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);
  return (
    <Screen>
      <AppText variant="title">Backend not configured</AppText>
      <Card>
        <AppText>
          This build has no Supabase project configured, so sign-in and data are unavailable. Copy
          .env.example to .env, set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then
          rebuild. See docs/SETUP.md.
        </AppText>
      </Card>
    </Screen>
  );
}
