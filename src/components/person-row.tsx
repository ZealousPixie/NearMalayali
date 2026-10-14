import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppText, Avatar } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import type { PersonSummary } from '@/lib/types';

export function PersonRow({ person, detail }: { person: PersonSummary; detail?: string | null }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${person.display_name}'s profile`}
      onPress={() => router.push({ pathname: '/profile/[id]', params: { id: person.id } })}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, opacity: pressed ? 0.7 : 1 })}>
      <Avatar path={person.avatar_path} name={person.display_name} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AppText style={{ fontWeight: '600' }} numberOfLines={1}>
            {person.display_name}
          </AppText>
          {person.is_verified ? <Ionicons name="checkmark-circle" size={16} color={c.primary} accessibilityLabel="Verified" /> : null}
        </View>
        <AppText variant="caption" muted numberOfLines={1}>
          @{person.username}
          {detail ? ` · ${detail}` : ''}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
    </Pressable>
  );
}
