import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useTheme } from '@/constants/theme';
import { openNotificationTarget } from '@/lib/notification-routing';
import { registerForPush } from '@/lib/push';

export default function AppLayout() {
  const c = useTheme();

  // Register this device for push (without prompting; the prompt is shown
  // when the member turns on alerts or from notification settings), and
  // route taps on notifications.
  useEffect(() => {
    registerForPush(false).catch(() => undefined);
    const last = Notifications.getLastNotificationResponse();
    if (last) openNotificationTarget(last.notification.request.content.data as { screen?: string });
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openNotificationTarget(response.notification.request.content.data as { screen?: string });
    });
    return () => sub.remove();
  }, []);
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
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="connections" options={{ title: 'Connections' }} />
      <Stack.Screen name="new-chat" options={{ title: 'New message' }} />
      <Stack.Screen name="chat/[id]" options={{ title: '' }} />
      <Stack.Screen name="chat-info/[id]" options={{ title: 'Details' }} />
      <Stack.Screen name="location-permission" options={{ title: '', presentation: 'modal' }} />
    </Stack>
  );
}
