import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { firstError, otpSchema, passwordSchema } from '@/lib/validation';
import { useAuth } from '@/providers/auth-provider';

export default function ResetPassword() {
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const { session, setRecoveryInProgress } = useAuth();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ code?: string | null; password?: string | null; confirm?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Once the code is accepted we only need to retry saving the password.
  const [codeAccepted, setCodeAccepted] = useState(false);

  async function submit() {
    const next = {
      code: codeAccepted ? null : firstError(otpSchema, code),
      password: firstError(passwordSchema, password),
      confirm: password === confirm ? null : 'Passwords don\'t match.',
    };
    setErrors(next);
    if (next.code || next.password || next.confirm) return;

    setBusy(true);
    setError(null);
    if (!codeAccepted || !session) {
      // Verifying the code signs the person in; hold them on this screen.
      setRecoveryInProgress(true);
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'recovery' });
      if (verifyError) {
        setRecoveryInProgress(false);
        setBusy(false);
        setError(friendlyError(verifyError));
        return;
      }
      setCodeAccepted(true);
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(friendlyError(updateError));
      return;
    }
    // Password saved: release the hold and let the root layout route onwards.
    setRecoveryInProgress(false);
  }

  return (
    <Screen edges={['bottom']}>
      <AppText variant="title">Choose a new password</AppText>
      <AppText muted>Enter the code we emailed to {email} and your new password.</AppText>
      {error ? <Banner message={error} /> : null}
      {!codeAccepted ? (
        <TextField
          label="Reset code"
          value={code}
          onChangeText={setCode}
          error={errors.code}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
        />
      ) : (
        <Banner tone="success" message="Code accepted. Now save your new password." />
      )}
      <TextField
        label="New password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        hint="At least 8 characters, with letters and numbers."
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <TextField
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={submit}
      />
      <Button title="Save new password" onPress={submit} loading={busy} />
    </Screen>
  );
}
