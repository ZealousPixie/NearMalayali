// Someone else's profile, as get_profile() allows the viewer to see it.
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { ProfileView } from '@/components/profile-view';
import { RelationshipActions } from '@/components/relationship-actions';
import { UserPosts } from '@/components/user-posts';
import { Banner, Button, EmptyState, ErrorView, LoadingView, Screen } from '@/components/ui';
import { blockUser, getProfile } from '@/lib/api';
import { useAsync } from '@/hooks/use-async';
import { friendlyError } from '@/lib/errors';
import type { PublicProfile } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

export default function OtherProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
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
      <RelationshipActions userId={profile.id} name={profile.display_name} />
      <Button title={`Block ${profile.display_name}`} variant="danger" icon="ban" onPress={confirmBlock} />
      <Button
        title={`Report ${profile.display_name}`}
        variant="ghost"
        icon="flag-outline"
        onPress={() =>
          router.push({ pathname: '/report', params: { type: 'profile', id: profile.id, name: profile.display_name, user: profile.id } })
        }
      />
      {session ? <UserPosts userId={profile.id} me={session.user.id} /> : null}
    </Screen>
  );
}
