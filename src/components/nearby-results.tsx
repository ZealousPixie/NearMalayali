// Result list + filters shared by "around me" and "around a town".
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Avatar, Button, Chip, Divider, MultiChips, TextField } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import type { NearbyPerson } from '@/lib/api';
import { CONNECTION_PREFERENCES } from '@/lib/types';

export interface NearbyFilters {
  interests: string[];
  preferences: string[];
}

export function FilterBar({ value, onChange }: { value: NearbyFilters; onChange: (f: NearbyFilters) => void }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [interestText, setInterestText] = useState(value.interests.join(', '));
  const active = value.interests.length + value.preferences.length;
  return (
    <View style={{ gap: Spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide filters' : 'Show filters'}
        onPress={() => setOpen(!open)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: 44 }}>
        <Ionicons name="filter" size={18} color={c.primary} />
        <AppText style={{ color: c.primary, fontWeight: '600' }}>{active ? `Filters (${active})` : 'Filters'}</AppText>
      </Pressable>
      {open ? (
        <View style={{ gap: Spacing.md }}>
          <TextField
            label="Shared interests"
            value={interestText}
            onChangeText={setInterestText}
            placeholder="e.g. cricket, cooking"
            hint="Only matches people who share their interests publicly."
            onEndEditing={() =>
              onChange({
                ...value,
                interests: interestText
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 10),
              })
            }
          />
          <AppText style={{ fontWeight: '600' }}>Open to</AppText>
          <MultiChips options={CONNECTION_PREFERENCES} values={value.preferences} onChange={(p) => onChange({ ...value, preferences: p })} />
          {active ? (
            <Button
              title="Clear filters"
              variant="ghost"
              onPress={() => {
                setInterestText('');
                onChange({ interests: [], preferences: [] });
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function NearbyPersonRow({ person, showDistance }: { person: NearbyPerson; showDistance: boolean }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${person.display_name}'s profile${showDistance ? `, ${person.distance_label} away` : ''}`}
      onPress={() => router.push({ pathname: '/profile/[id]', params: { id: person.id } })}
      style={({ pressed }) => ({ flexDirection: 'row', gap: Spacing.md, paddingVertical: Spacing.sm, opacity: pressed ? 0.7 : 1 })}>
      <Avatar path={person.avatar_path} name={person.display_name} size={52} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AppText style={{ fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
            {person.display_name}
          </AppText>
          {person.is_verified ? <Ionicons name="checkmark-circle" size={16} color={c.primary} accessibilityLabel="Verified" /> : null}
          {person.is_connected ? (
            <AppText variant="caption" style={{ color: c.primary }}>
              · Connected
            </AppText>
          ) : null}
        </View>
        <AppText variant="caption" muted numberOfLines={1}>
          {[showDistance ? person.distance_label : null, person.home_region].filter(Boolean).join(' · ') || `@${person.username}`}
        </AppText>
        {person.interests?.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {person.interests.slice(0, 3).map((i) => (
              <Chip key={i} label={i} />
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function NearbyList({ people, showDistance }: { people: NearbyPerson[]; showDistance: boolean }) {
  return (
    <View>
      {people.map((p, i) => (
        <View key={p.id}>
          {i > 0 ? <Divider /> : null}
          <NearbyPersonRow person={p} showDistance={showDistance} />
        </View>
      ))}
    </View>
  );
}
