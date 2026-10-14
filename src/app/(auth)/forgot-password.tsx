import { router } from 'expo-router';
import { useState } from 'react';

import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { emailSchema, firstError } from '@/lib/validation';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const err = firstError(emailSchema, email);
    setEmailError(err);
    if (err) return;
    setBusy(true);
    setError(null);
    const normalized = emailSchema.parse(email);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalized);
    setBusy(false);
    if (resetError) {
      setError(friendlyError(resetError));
      return;
    }
    router.replace({ pathname: '/reset-password', params: { email: normalized } });
  }

  return (
    <Screen edges={['bottom']}>
      <AppText variant="title">Reset your password</AppText>
      <AppText muted>Enter your account email. If an account exists, we'll send a 6-digit reset code.</AppText>
      {error ? <Banner message={error} /> : null}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={emailError}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        onSubmitEditing={submit}
      />
      <Button title="Send reset code" onPress={submit} loading={busy} />
    </Screen>
  );
}
