// Welcome screen.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { AppText, Button, Screen } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';

const POINTS: { icon: 'people' | 'shield-checkmark' | 'chatbubbles'; text: string }[] = [
  { icon: 'people', text: 'Find Malayalis in your town, wherever in the world you live.' },
  { icon: 'shield-checkmark', text: 'You choose if and when you can be discovered. Your exact location is never shown.' },
  { icon: 'chatbubbles', text: 'Make friends, swap tips and plan meetups.' },
];

export default function Welcome() {
  const c = useTheme();
  return (
    <Screen>
      <View style={{ gap: Spacing.sm, marginTop: Spacing.xxl }}>
        <AppText variant="hero" style={{ color: c.primary }}>
          NearMalayali
        </AppText>
        <AppText variant="subtitle" muted>
          Your community, wherever you are.
        </AppText>
      </View>
      <View style={{ gap: Spacing.lg, marginVertical: Spacing.xl }}>
        {POINTS.map((p) => (
          <View key={p.text} style={{ flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' }}>
            <Ionicons name={p.icon} size={24} color={c.accent} />
            <AppText style={{ flex: 1 }}>{p.text}</AppText>
          </View>
        ))}
      </View>
      <Button title="Create an account" onPress={() => router.push('/sign-up')} />
      <Button title="I already have an account" variant="secondary" onPress={() => router.push('/sign-in')} />
    </Screen>
  );
}
