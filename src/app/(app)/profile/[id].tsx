// Someone else's profile, as get_profile() allows the viewer to see it.
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { ProfileView } from '@/components/profile-view';
import { Banner, Button, EmptyState, ErrorView, LoadingView, NotYetAvailable, Screen } from '@/components/ui';
import { blockUser, getProfile } from '@/lib/api';
import { useAsync } from '@/hooks/use-async';
import { friendlyError } from '@/lib/errors';
import type { PublicProfile } from '@/lib/types';

export default function OtherProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [actionError, setActionError] = useState<string | null>(null);
  const fetchProfile = useCallback(() => getProfile(id), [id]);
  const { data: profile, error, reload: load } = useAsync<PublicProfile | null>(fetchProfile);

  function confirmBlock() {
    if (!profile) return;
    Alert.alert(
      `Block ${profile.display_name}?`,
      'You won\'t see each other anywhere in NearMalayali, including nearby discovery, and any connection between you is removed. They are not told.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(profile.id);
              router.back();
            } catch (e) {
              setActionError(friendlyError(e));
            }
          },
        },
      ],
    );
  }

  if (error && profile === undefined) return <ErrorView message={friendlyError(error)} onRetry={load} />;
  if (profile === undefined) return <LoadingView />;
  if (profile === null) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="eye-off-outline" title="Profile not available" message="This profile doesn't exist or isn't available to you." />
      </Screen>
    );
  }
  if (profile.is_self) return <Redirect href="/profile" />;

  return (
    <Screen edges={['bottom']}>
      <ProfileView profile={profile} />
      {actionError ? <Banner message={actionError} /> : null}
      <NotYetAvailable
        stage="Stage C"
        feature="Connect, follow and message"
        details="Connection requests, following and messaging arrive with the social features."
      />
      <Button title={`Block ${profile.display_name}`} variant="danger" icon="ban" onPress={confirmBlock} />
      <NotYetAvailable stage="Stage D" feature="Report this profile" details="Reporting to moderators arrives with the safety tools. Blocking works now." />
    </Screen>
  );
}
