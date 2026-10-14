import { Stack } from 'expo-router';

import { useTheme } from '@/constants/theme';

export default function AppLayout() {
  const c = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: c.primary,
        headerTitleStyle: { color: c.text },
        headerStyle: { backgroundColor: c.background },
        contentStyle: { backgroundColor: c.background },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="profile/[id]" options={{ title: 'Profile' }} />
      <Stack.Screen name="edit-profile" options={{ title: 'Edit profile' }} />
      <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
      <Stack.Screen name="settings/privacy" options={{ title: 'Privacy' }} />
      <Stack.Screen name="settings/discovery" options={{ title: 'Discovery & location' }} />
      <Stack.Screen name="settings/notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="settings/blocked" options={{ title: 'Blocked people' }} />
      <Stack.Screen name="settings/account" options={{ title: 'Account' }} />
    </Stack>
  );
}
