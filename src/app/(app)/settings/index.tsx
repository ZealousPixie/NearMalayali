import { router } from 'expo-router';
import { Alert } from 'react-native';

import { AppText, Card, Divider, ListRow, Screen } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';

export default function SettingsHome() {
  const { signOut, session } = useAuth();

  function confirmSignOut() {
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  return (
    <Screen edges={['bottom']}>
      <Card>
        <ListRow icon="person-outline" label="Edit profile" onPress={() => router.push('/edit-profile')} />
        <Divider />
        <ListRow icon="lock-closed-outline" label="Privacy" detail="Who sees your details and can contact you" onPress={() => router.push('/settings/privacy')} />
        <Divider />
        <ListRow icon="navigate-outline" label="Discovery & location" detail="Nearby visibility, map, alerts, pause" onPress={() => router.push('/settings/discovery')} />
        <Divider />
        <ListRow icon="notifications-outline" label="Notifications" onPress={() => router.push('/settings/notifications')} />
        <Divider />
        <ListRow icon="ban-outline" label="Blocked people" onPress={() => router.push('/settings/blocked')} />
      </Card>
      <Card>
        <ListRow icon="key-outline" label="Account" detail={session?.user.email} onPress={() => router.push('/settings/account')} />
        <Divider />
        <ListRow icon="document-text-outline" label="Terms of Service" onPress={() => router.push('/legal/terms')} />
        <Divider />
        <ListRow icon="shield-outline" label="Privacy Policy" onPress={() => router.push('/legal/privacy')} />
        <Divider />
        <ListRow icon="people-outline" label="Community Guidelines" onPress={() => router.push('/legal/guidelines')} />
      </Card>
      <Card>
        <ListRow icon="log-out-outline" label="Sign out" danger onPress={confirmSignOut} />
      </Card>
      <AppText variant="caption" muted style={{ textAlign: 'center' }}>
        NearMalayali · development build
      </AppText>
    </Screen>
  );
}
