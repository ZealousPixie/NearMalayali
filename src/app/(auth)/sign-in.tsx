import { router } from 'expo-router';
import { useState } from 'react';

import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { emailSchema, firstError } from '@/lib/validation';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const eErr = firstError(emailSchema, email);
    setEmailError(eErr);
    if (eErr || !password) {
      if (!password) setError('Enter your password.');
      return;
    }
    setBusy(true);
    setError(null);
    setUnverified(false);
    const normalized = emailSchema.parse(email);
    const { error: err } = await supabase.auth.signInWithPassword({ email: normalized, password });
    setBusy(false);
    if (err) {
      setError(friendlyError(err));
      setUnverified(/email not confirmed/i.test(err.message));
    }
    // On success the root layout routes to onboarding or the app.
  }

  return (
    <Screen edges={['bottom']}>
      <AppText variant="title">Welcome back</AppText>
      {error ? (
        <Banner
          message={error}
          action={
            unverified ? (
              <Button
                title="Verify my email"
                variant="secondary"
                onPress={() => router.push({ pathname: '/verify-email', params: { email: emailSchema.parse(email), resend: '1' } })}
              />
            ) : undefined
          }
        />
      ) : null}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={emailError}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
      />
      <Button title="Sign in" onPress={submit} loading={busy} />
      <Button title="Forgot your password?" variant="ghost" onPress={() => router.push('/forgot-password')} />
    </Screen>
  );
}
