// Community: the feed, groups, events and the noticeboard.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { EventsSection } from '@/components/community/events-section';
import { FeedSection } from '@/components/community/feed-section';
import { GroupsSection } from '@/components/community/groups-section';
import { NoticesSection } from '@/components/community/notices-section';
import { AppText, ChoiceChips, Screen } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useAuth } from '@/providers/auth-provider';

type Section = 'feed' | 'groups' | 'events' | 'notices';

export default function CommunityTab() {
  const c = useTheme();
  const { session } = useAuth();
  const [section, setSection] = useState<Section>('feed');
  if (!session) return null;
  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="title">Community</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Connections and requests"
          onPress={() => router.push('/connections')}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="people-circle-outline" size={28} color={c.primary} />
        </Pressable>
      </View>
      <ChoiceChips
        options={[
          { value: 'feed', label: 'Feed' },
          { value: 'groups', label: 'Groups' },
          { value: 'events', label: 'Events' },
          { value: 'notices', label: 'Noticeboard' },
        ]}
        value={section}
        onChange={setSection}
      />
      {section === 'feed' ? <FeedSection me={session.user.id} /> : null}
      {section === 'groups' ? <GroupsSection /> : null}
      {section === 'events' ? <EventsSection /> : null}
      {section === 'notices' ? <NoticesSection /> : null}
    </Screen>
  );
}
