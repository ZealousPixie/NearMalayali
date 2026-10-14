import { AppText, NotYetAvailable, Screen } from '@/components/ui';

export default function CommunityTab() {
  return (
    <Screen edges={['top']}>
      <AppText variant="title">Community</AppText>
      <NotYetAvailable
        stage="Stage C"
        feature="Feed, groups, events and noticeboard"
        details="Posts from people and groups you follow, local and interest groups, events with RSVPs, and a noticeboard for jobs, housing and recommendations."
      />
    </Screen>
  );
}
