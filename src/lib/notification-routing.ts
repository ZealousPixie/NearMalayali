// Where tapping a notification (in-app or push) takes you.
import { router } from 'expo-router';

export function openNotificationTarget(data: { screen?: unknown } | null | undefined) {
  switch (data?.screen) {
    case 'discover':
      router.navigate('/');
      break;
    default:
      router.navigate('/notifications');
  }
}
