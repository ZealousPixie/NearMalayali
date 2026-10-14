import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { ProfileView } from '@/components/profile-view';
import { AppText, Button, ErrorView, LoadingView, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { getProfile } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import type { PublicProfile } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

export default function MyProfile() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      setProfile(await getProfile(session.user.id));
    } catch (e) {
      setError(e);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (error && !profile) return <ErrorView message={friendlyError(error)} onRetry={load} />;
  if (!profile) return <LoadingView />;

  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="title">Profile</AppText>
      </View>
      <ProfileView profile={profile} />
      <View style={{ gap: Spacing.sm }}>
        <Button title="Edit profile" icon="create-outline" onPress={() => router.push('/edit-profile')} />
        <Button title="Settings & privacy" variant="secondary" icon="settings-outline" onPress={() => router.push('/settings')} />
      </View>
      <AppText variant="caption" muted>
        This is how you see your own profile. Others only see the fields your privacy settings allow.
      </AppText>
    </Screen>
  );
}
