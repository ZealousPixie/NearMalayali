// Where tapping a notification (in-app or push) takes you.
import { router } from 'expo-router';

export function openNotificationTarget(data: { screen?: unknown; id?: unknown; tab?: unknown } | null | undefined) {
  const id = typeof data?.id === 'string' ? data.id : null;
  switch (data?.screen) {
    case 'discover':
      router.navigate('/');
      break;
    case 'conversation':
      if (id) router.push({ pathname: '/chat/[id]', params: { id } });
      else router.navigate('/messages');
      break;
    case 'profile':
      if (id) router.push({ pathname: '/profile/[id]', params: { id } });
      else router.navigate('/notifications');
      break;
    case 'post':
      if (id) router.push({ pathname: '/post/[id]', params: { id } });
      else router.navigate('/community');
      break;
    case 'group':
      if (id) router.push({ pathname: '/group/[id]', params: { id } });
      else router.navigate('/community');
      break;
    case 'event':
      if (id) router.push({ pathname: '/event/[id]', params: { id } });
      else router.navigate('/community');
      break;
    case 'connections':
      router.push({ pathname: '/connections', params: { tab: typeof data?.tab === 'string' ? data.tab : 'connections' } });
      break;
    default:
      router.navigate('/notifications');
  }
}
