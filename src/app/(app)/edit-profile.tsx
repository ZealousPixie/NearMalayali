import { router } from 'expo-router';
import { useState } from 'react';

import { ProfileForm } from '@/components/profile-form';
import { Banner, Button, Card, Screen, TextField } from '@/components/ui';
import { setUsername, updateOwnProfile } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { displayNameSchema, firstError, usernameSchema } from '@/lib/validation';
import { useAuth } from '@/providers/auth-provider';

export default function EditProfile() {
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [username, setUsernameValue] = useState(profile?.username ?? '');
  const [errors, setErrors] = useState<{ displayName?: string | null; username?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function saveIdentity() {
    const next = { displayName: firstError(displayNameSchema, displayName), username: firstError(usernameSchema, username) };
    setErrors(next);
    if (next.displayName || next.username) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (displayName.trim() !== profile?.display_name) await updateOwnProfile({ display_name: displayName.trim() });
      const normalized = usernameSchema.parse(username);
      if (normalized !== profile?.username) await setUsername(normalized);
      await refreshProfile();
      setSaved(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Card>
        {error ? <Banner message={error} /> : null}
        {saved ? <Banner tone="success" message="Name and username saved." /> : null}
        <TextField label="Display name" value={displayName} onChangeText={setDisplayName} error={errors.displayName} maxLength={50} />
        <TextField
          label="Username"
          value={username}
          onChangeText={setUsernameValue}
          error={errors.username}
          autoCapitalize="none"
          autoCorrect={false}
          hint="You can change your username up to 3 times a month."
        />
        <Button title="Save name and username" variant="secondary" onPress={saveIdentity} loading={busy} />
      </Card>
      <ProfileForm submitLabel="Save profile" displayNameForAvatar={displayName || 'You'} showCover onSaved={() => router.back()} />
    </Screen>
  );
}
