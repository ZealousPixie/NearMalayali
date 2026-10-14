import { router } from 'expo-router';

import { openNotificationTarget } from '../notification-routing';

jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), push: jest.fn() } }));

describe('openNotificationTarget', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens a conversation', () => {
    openNotificationTarget({ screen: 'conversation', id: 'c1' });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'c1' } });
  });

  it('opens connection requests', () => {
    openNotificationTarget({ screen: 'connections', tab: 'requests' });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/connections', params: { tab: 'requests' } });
  });

  it('falls back to the notification centre for unknown or malformed data', () => {
    openNotificationTarget({ screen: 'profile', id: 42 });
    openNotificationTarget(null);
    expect(router.navigate).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledWith('/notifications');
  });
});
