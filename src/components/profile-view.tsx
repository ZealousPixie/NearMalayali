import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { View } from 'react-native';

import { AppText, Avatar, Card, Chip } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { publicImageUrl } from '@/lib/media';
import { CONNECTION_PREFERENCES, type PublicProfile } from '@/lib/types';

const PREF_LABEL = Object.fromEntries(CONNECTION_PREFERENCES.map((p) => [p.value, p.label]));

export function ProfileView({ profile }: { profile: PublicProfile }) {
  const c = useTheme();
  const cover = publicImageUrl(profile.cover_path);
  const memberSince = (() => {
    const [y, m] = profile.member_since.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  })();

  return (
    <View style={{ gap: Spacing.lg }}>
      {cover ? (
        <Image source={{ uri: cover }} style={{ width: '100%', aspectRatio: 3, borderRadius: Radius.md }} contentFit="cover" accessibilityLabel="Cover photo" />
      ) : null}
      <View style={{ flexDirection: 'row', gap: Spacing.lg, alignItems: 'center' }}>
        <Avatar path={profile.avatar_path} name={profile.display_name} size={80} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
            <AppText variant="title" numberOfLines={2} style={{ flexShrink: 1 }}>
              {profile.display_name}
            </AppText>
            {profile.is_verified ? <Ionicons name="checkmark-circle" size={20} color={c.primary} accessibilityLabel="Verified" /> : null}
          </View>
          <AppText muted>@{profile.username}</AppText>
          {profile.is_connected ? (
            <AppText variant="caption" style={{ color: c.primary, fontWeight: '600' }}>
              Connected
            </AppText>
          ) : null}
        </View>
      </View>

      {profile.bio ? <AppText>{profile.bio}</AppText> : null}

      <Card>
        {profile.home_region ? <Fact icon="location-outline" text={profile.home_region} /> : null}
        {profile.occupation ? <Fact icon="briefcase-outline" text={profile.occupation} /> : null}
        {profile.languages?.length ? <Fact icon="language-outline" text={profile.languages.join(', ')} /> : null}
        <Fact icon="calendar-outline" text={`Member since ${memberSince}`} />
      </Card>

      {profile.intro ? (
        <Card>
          <AppText variant="label" muted>
            Introduction
          </AppText>
          <AppText>{profile.intro}</AppText>
        </Card>
      ) : null}

      {profile.interests?.length ? (
        <View style={{ gap: Spacing.sm }}>
          <AppText variant="label" muted>
            Interests
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
            {profile.interests.map((i) => (
              <Chip key={i} label={i} />
            ))}
          </View>
        </View>
      ) : null}

      {profile.connection_preferences?.length ? (
        <View style={{ gap: Spacing.sm }}>
          <AppText variant="label" muted>
            Open to
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
            {profile.connection_preferences.map((p) => (
              <Chip key={p} label={PREF_LABEL[p] ?? p} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Fact({ icon, text }: { icon: 'location-outline' | 'briefcase-outline' | 'language-outline' | 'calendar-outline'; text: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
      <Ionicons name={icon} size={18} color={c.textSecondary} />
      <AppText style={{ flex: 1 }}>{text}</AppText>
    </View>
  );
}
