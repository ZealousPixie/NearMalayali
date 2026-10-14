// Shown to signed-in people whose account is deactivated or suspended.
import { useState } from 'react';

import { AppText, Banner, Button, Screen } from '@/components/ui';
import { reactivateAccount } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/providers/auth-provider';

export default function AccountInactive() {
  const { profile, refreshProfile, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suspended = profile?.account_status === 'suspended';

  async function reactivate() {
    setBusy(true);
    setError(null);
    try {
      await reactivateAccount();
      await refreshProfile();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <AppText variant="title">{suspended ? 'Account suspended' : 'Your account is deactivated'}</AppText>
      <AppText muted>
        {suspended
          ? 'This account was suspended for breaking the Community Guidelines. Contact support if you think this is a mistake.'
          : 'Your profile is hidden and you are not discoverable. Reactivate to pick up where you left off. Discovery stays off until you turn it on again.'}
      </AppText>
      {error ? <Banner message={error} /> : null}
      {!suspended ? <Button title="Reactivate my account" onPress={reactivate} loading={busy} /> : null}
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
