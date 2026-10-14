import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Banner, Button, Card, ChoiceChips, EmptyState, LoadingView, TextField } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { type EventSummary, listEvents } from '@/lib/community';
import { friendlyError } from '@/lib/errors';
import { formatEventTime } from '@/lib/format';

export function EventsSection() {
  const [scope, setScope] = useState<'upcoming' | 'mine'>('upcoming');
  const [region, setRegion] = useState('');
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents(await listEvents(scope, { region }));
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [scope, region]);

  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(load, 250);
      return () => clearTimeout(t);
    }, [load]),
  );

  return (
    <View style={{ gap: Spacing.md }}>
      <Button title="Create an event" icon="calendar-outline" onPress={() => router.push('/event-form')} />
      <ChoiceChips
        options={[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'mine', label: 'My events' },
        ]}
        value={scope}
        onChange={setScope}
      />
      <TextField label="Town or region" value={region} onChangeText={setRegion} placeholder="All places" />
      {error ? <Banner message={error} action={<Button title="Retry" variant="ghost" onPress={load} />} /> : null}
      {events === null && !error ? <LoadingView /> : null}
      {events?.length === 0 ? (
        <EmptyState icon="calendar-clear-outline" title="No upcoming events" message="Create one for your community, or check back later." />
      ) : null}
      {events?.map((e) => <EventRow key={e.id} event={e} />)}
    </View>
  );
}

export function EventRow({ event: e }: { event: EventSummary }) {
  const c = useTheme();
  const status = e.cancelled
    ? 'Cancelled'
    : e.is_host
      ? 'Hosting'
      : e.my_status === 'going'
        ? 'Going'
        : e.my_status === 'interested'
          ? 'Interested'
          : e.my_status === 'invited'
            ? 'Invited'
            : null;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/event/[id]', params: { id: e.id } })}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
        <Ionicons name="calendar" size={24} color={e.cancelled ? c.textSecondary : c.accent} />
        <View style={{ flex: 1 }}>
          <AppText style={{ fontWeight: '600', textDecorationLine: e.cancelled ? 'line-through' : 'none' }} numberOfLines={1}>
            {e.title}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {formatEventTime(e.starts_at)}
            {e.venue_name || e.region ? ` · ${e.venue_name || e.region}` : ''}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {[`${e.going_count} going`, e.group_name, status].filter(Boolean).join(' · ')}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
      </Card>
    </Pressable>
  );
}
