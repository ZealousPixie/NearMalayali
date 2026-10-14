import { AppText, NotYetAvailable, Screen } from '@/components/ui';

export default function MapTab() {
  return (
    <Screen edges={['top']}>
      <AppText variant="title">Map</AppText>
      <NotYetAvailable
        stage="Stage B"
        feature="Community map"
        details="An interactive map showing approximate areas where Malayalis are, never exact positions. Areas only appear once at least three discoverable people are there, and you can search around any town without revealing your own location."
      />
    </Screen>
  );
}
