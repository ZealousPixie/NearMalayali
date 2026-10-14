import { fireEvent, render, screen } from '@testing-library/react-native';

import SignIn from '@/app/(auth)/sign-in';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: jest.fn() } },
}));
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => ({ isConnected: true }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const signIn = supabase.auth.signInWithPassword as jest.Mock;

describe('Sign in screen', () => {
  beforeEach(() => signIn.mockReset());

  it('validates before calling the server', async () => {
    await render(<SignIn />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('shows a friendly message for wrong credentials', async () => {
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByLabelText('Email'), ' Anu@Example.com ');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret123');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
    expect(signIn).toHaveBeenCalledWith({ email: 'anu@example.com', password: 'secret123' });
  });
});
