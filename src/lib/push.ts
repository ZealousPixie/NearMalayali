// Push notification registration. Tokens are stored server-side per device;
// the server decides what to send and respects notification preferences.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

let registeredToken: string | null = null;

// Show alerts while the app is open too (as a banner, without sound).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type PushRegistration =
  | { ok: true; token: string }
  | { ok: false; reason: 'NOT_A_DEVICE' | 'PERMISSION_DENIED' | 'NO_PROJECT_ID' | 'ERROR'; detail?: string };

export async function registerForPush(askIfNeeded: boolean): Promise<PushRegistration> {
  if (!Device.isDevice) return { ok: false, reason: 'NOT_A_DEVICE' };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync('proximity', {
      name: 'Malayalis nearby',
      description: 'When a fellow Malayali who also turned on alerts is close by',
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && askIfNeeded) {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return { ok: false, reason: 'PERMISSION_DENIED' };

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { ok: false, reason: 'NO_PROJECT_ID' };

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (error) throw error;
    registeredToken = token;
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: 'ERROR', detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Call before signing out so this device stops receiving the account's pushes. */
export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  await supabase.rpc('unregister_push_token', { p_token: registeredToken });
  registeredToken = null;
}
