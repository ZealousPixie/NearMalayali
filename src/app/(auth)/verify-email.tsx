import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { firstError, otpSchema } from '@/lib/validation';

const RESEND_SECONDS = 60;

export default function VerifyEmail() {
  const params = useLocalSearchParams<{ email: string; resend?: string }>();
  const email = params.email ?? '';
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    applyResendResult(await supabase.auth.resend({ type: 'signup', email }));
  }

  function applyResendResult({ error: err }: { error: unknown }) {
    if (err) {
      setInfo(null);
      setError(friendlyError(err));
    } else {
      setError(null);
      setInfo(`We've sent a new code to ${email}.`);
      setCooldown(RESEND_SECONDS);
    }
  }

  // Arriving from sign-in with an unverified email: send a fresh code once.
  useEffect(() => {
    if (params.resend === '1' && email) {
      supabase.auth.resend({ type: 'signup', email }).then(applyResendResult);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify() {
    const err = firstError(otpSchema, code);
    setCodeError(err);
    if (err) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    setBusy(false);
    if (verifyError) setError(friendlyError(verifyError));
    // Success signs the person in; the root layout moves them to onboarding.
  }

  return (
    <Screen edges={['bottom']}>
      <AppText variant="title">Check your email</AppText>
      <AppText muted>Enter the 6-digit code we sent to {email || 'your email address'}. It can take a minute to arrive; check spam too.</AppText>
      {error ? <Banner message={error} /> : null}
      {info ? <Banner tone="info" message={info} /> : null}
      <TextField
        label="Verification code"
        value={code}
        onChangeText={setCode}
        error={codeError}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        onSubmitEditing={verify}
      />
      <Button title="Verify" onPress={verify} loading={busy} />
      <Button
        title={cooldown > 0 ? `Send a new code (${cooldown}s)` : 'Send a new code'}
        variant="ghost"
        onPress={resend}
        disabled={cooldown > 0 || !email}
      />
    </Screen>
  );
}
