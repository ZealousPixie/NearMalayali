import { useState } from 'react';
import { Alert } from 'react-native';

import { AppText, Banner, Button, Card, Screen, TextField } from '@/components/ui';
import { deactivateAccount, deleteAccountPermanently, verifyPassword } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { firstError, passwordSchema } from '@/lib/validation';
import { useAuth } from '@/providers/auth-provider';

export default function AccountSettings() {
  const { session, refreshProfile, signOut } = useAuth();
  const email = session?.user.email ?? '';

  // Change password
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  // Delete
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteWord, setDeleteWord] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  async function changePassword() {
    setPwDone(false);
    const err = !current ? 'Enter your current password.' : firstError(passwordSchema, next);
    setPwError(err);
    if (err) return;
    setPwBusy(true);
    try {
      await verifyPassword(email, current); // also satisfies "recent sign-in"
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setCurrent('');
      setNext('');
      setPwDone(true);
    } catch (e) {
      setPwError(friendlyError(e));
    } finally {
      setPwBusy(false);
    }
  }

  function confirmDeactivate() {
    Alert.alert(
      'Deactivate your account?',
      'Your profile will be hidden, discovery is switched off and your location is deleted. Sign in again any time to reactivate.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            setDeactivateError(null);
            try {
              await deactivateAccount();
              await refreshProfile();
            } catch (e) {
              setDeactivateError(friendlyError(e));
            }
          },
        },
      ],
    );
  }

  async function deletePermanently() {
    setDeleteError(null);
    if (deleteWord.trim() !== 'DELETE') {
      setDeleteError('Type DELETE in capitals to confirm.');
      return;
    }
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    setDeleteBusy(true);
    try {
      await verifyPassword(email, deletePassword);
      await deleteAccountPermanently();
      await signOut();
    } catch (e) {
      setDeleteError(friendlyError(e));
      setDeleteBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Card>
        <AppText variant="label" muted>
          Email
        </AppText>
        <AppText>{email}</AppText>
      </Card>

      <Card>
        <AppText variant="subtitle">Change password</AppText>
        {pwError ? <Banner message={pwError} /> : null}
        {pwDone ? <Banner tone="success" message="Password changed." /> : null}
        <TextField label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
        <TextField
          label="New password"
          value={next}
          onChangeText={setNext}
          secureTextEntry
          autoComplete="new-password"
          hint="At least 8 characters, with letters and numbers."
        />
        <Button title="Change password" variant="secondary" onPress={changePassword} loading={pwBusy} />
      </Card>

      <Card>
        <AppText variant="subtitle">Deactivate account</AppText>
        <AppText muted>Hide your profile and stop discovery. Nothing is deleted; sign in to come back.</AppText>
        {deactivateError ? <Banner message={deactivateError} /> : null}
        <Button title="Deactivate" variant="secondary" onPress={confirmDeactivate} />
      </Card>

      <Card>
        <AppText variant="subtitle">Delete account permanently</AppText>
        <AppText muted>
          This deletes your profile, photos, settings, location data and consent records straight away. It can't be undone.
        </AppText>
        {deleteError ? <Banner message={deleteError} /> : null}
        <TextField label="Password" value={deletePassword} onChangeText={setDeletePassword} secureTextEntry autoComplete="current-password" />
        <TextField label='Type "DELETE" to confirm' value={deleteWord} onChangeText={setDeleteWord} autoCapitalize="characters" />
        <Button title="Delete my account" variant="danger" onPress={deletePermanently} loading={deleteBusy} />
      </Card>
    </Screen>
  );
}
