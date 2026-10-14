// Shown to signed-in people whose account is deactivated or suspended.
import { useEffect, useState } from 'react';

import { AppText, Banner, Button, Screen } from '@/components/ui';
import { reactivateAccount } from '@/lib/api';
import { myRestriction, type Restriction } from '@/lib/moderation';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/providers/auth-provider';

export default function AccountInactive() {
  const { profile, refreshProfile, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suspended = profile?.account_status === 'suspended';
  const [restriction, setRestriction] = useState<Restriction | null>(null);

  useEffect(() => {
    if (!suspended) return;
    let active = true;
    myRestriction().then(
      (r) => active && setRestriction(r),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [suspended]);

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
      {restriction ? (
        <AppText>
          Reason: {restriction.reason}
          {'\n'}
          {restriction.suspended_until
            ? `Suspended until ${new Date(restriction.suspended_until).toLocaleString()}. You can use NearMalayali again after that.`
            : 'This suspension has no end date.'}
        </AppText>
      ) : null}
      {suspended ? <Button title="Check again" variant="secondary" onPress={refreshProfile} /> : null}
      {error ? <Banner message={error} /> : null}
      {!suspended ? <Button title="Reactivate my account" onPress={reactivate} loading={busy} /> : null}
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
