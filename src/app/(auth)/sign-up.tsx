import { router } from 'expo-router';
import { useState } from 'react';

import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { emailSchema, firstError, passwordSchema } from '@/lib/validation';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null; confirm?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next = {
      email: firstError(emailSchema, email),
      password: firstError(passwordSchema, password),
      confirm: password === confirm ? null : 'Passwords don\'t match.',
    };
    setErrors(next);
    if (next.email || next.password || next.confirm) return;

    setBusy(true);
    setError(null);
    const normalized = emailSchema.parse(email);
    const { error: err } = await supabase.auth.signUp({ email: normalized, password });
    setBusy(false);
    if (err) {
      setError(friendlyError(err));
      return;
    }
    // Supabase deliberately responds the same way for an existing email (to
    // avoid revealing who has an account), so we always go to verification.
    router.replace({ pathname: '/verify-email', params: { email: normalized } });
  }

  return (
    <Screen edges={['bottom']}>
      <AppText variant="title">Create your account</AppText>
      <AppText muted>We'll email you a 6-digit code to confirm it's you.</AppText>
      {error ? <Banner message={error} /> : null}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        hint="At least 8 characters, with letters and numbers."
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <TextField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={submit}
      />
      <Button title="Create account" onPress={submit} loading={busy} />
      <AppText variant="caption" muted>
        You'll review and accept the Terms, Privacy Policy and Community Guidelines when you set up your profile.
      </AppText>
    </Screen>
  );
}
