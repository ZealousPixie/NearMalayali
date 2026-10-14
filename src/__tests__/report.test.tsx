import { fireEvent, render, screen } from '@testing-library/react-native';

import Report from '@/app/(app)/report';
import { blockUser } from '@/lib/api';
import { reportContent } from '@/lib/moderation';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => ({ isConnected: true }) }));
jest.mock('@/lib/moderation', () => ({ ...jest.requireActual('@/lib/moderation'), reportContent: jest.fn() }));
jest.mock('@/lib/api', () => ({ blockUser: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), dismissAll: jest.fn() },
  useLocalSearchParams: () => ({ type: 'post', id: 'p1', name: 'Biju', user: 'u2' }),
}));

describe('Report screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('needs a reason before sending', async () => {
    await render(<Report />);
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
  });

  it('sends the report and blocks when asked', async () => {
    (reportContent as jest.Mock).mockResolvedValue(7);
    (blockUser as jest.Mock).mockResolvedValue(undefined);
    await render(<Report />);
    await fireEvent.press(screen.getByText('Scam or fraud'));
    await fireEvent(screen.getByRole('switch'), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Thanks for reporting')).toBeTruthy();
    expect(reportContent).toHaveBeenCalledWith('post', 'p1', 'scam', '');
    expect(blockUser).toHaveBeenCalledWith('u2');
  });

  it('does not claim success when the report fails', async () => {
    (reportContent as jest.Mock).mockRejectedValue({ message: 'REPORT_TARGET_NOT_FOUND' });
    await render(<Report />);
    await fireEvent.press(screen.getByText('Spam'));
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('This is no longer available to report.')).toBeTruthy();
    expect(screen.queryByText('Thanks for reporting')).toBeNull();
    expect(blockUser).not.toHaveBeenCalled();
  });
});
