// An event: details, RSVP, attendees, invitations and host tools.
import { openBrowserAsync } from 'expo-web-browser';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { PersonRow } from '@/components/person-row';
import { AppText, Banner, Button, Card, ChoiceChips, ErrorView, LoadingView, Screen, ToggleRow } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { cancelEvent, eventAttendees, eventDetails, type EventDetails, rsvpEvent } from '@/lib/community';
import { friendlyError } from '@/lib/errors';
import { formatEventTime } from '@/lib/format';

type Attendee = Awaited<ReturnType<typeof eventAttendees>>[number];
type Choice = 'going' | 'interested' | 'not_going';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<EventDetails | null | undefined>(undefined);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, a] = await Promise.all([eventDetails(id), eventAttendees(id)]);
      setEvent(e);
      setAttendees(a);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function rsvp(status: Choice, hide: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      await rsvpEvent(id, status, hide);
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && event === undefined) return <ErrorView message={friendlyError(error)} onRetry={load} />;
  if (event === undefined) return <LoadingView />;
  if (event === null) return <ErrorView message="This event isn't available to you." />;

  const ended = new Date(event.ends_at ?? new Date(event.starts_at).getTime() + 6 * 3600_000) < new Date();
  const open = !event.cancelled_at && !ended;
  const myChoice: Choice | null = event.my_status === 'invited' ? null : (event.my_status as Choice | null);

  function confirmCancel() {
    Alert.alert('Cancel this event?', 'Everyone going or interested is notified. This can\'t be undone.', [
      { text: 'Keep event', style: 'cancel' },
      {
        text: 'Cancel event',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelEvent(id);
            await load();
          } catch (e) {
            setActionError(friendlyError(e));
          }
        },
      },
    ]);
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Event' }} />
      {event.cancelled_at ? <Banner message="This event has been cancelled." /> : ended ? <Banner tone="info" message="This event has ended." /> : null}
      <AppText variant="title">{event.title}</AppText>
      <Card>
        <AppText style={{ fontWeight: '600' }}>
          {formatEventTime(event.starts_at)}
          {event.ends_at ? ` – ${formatEventTime(event.ends_at)}` : ''}
        </AppText>
        {event.venue_name ? <AppText>{event.venue_name}</AppText> : null}
        {event.address ? (
          <AppText selectable>{event.address}</AppText>
        ) : event.address_visibility === 'attendees' && !event.is_host ? (
          <AppText variant="caption" muted>
            The address{event.has_online_link ? ' and online link are' : ' is'} shown to people who are going.
          </AppText>
        ) : null}
        {event.region ? (
          <AppText variant="caption" muted>
            {event.region}
          </AppText>
        ) : null}
        {event.online_url ? (
          <Button title="Open online link" variant="secondary" icon="videocam-outline" onPress={() => openBrowserAsync(event.online_url!)} />
        ) : null}
      </Card>
      <PersonRow
        person={{ id: event.host_id, username: event.host_username, display_name: event.host_name, avatar_path: event.host_avatar }}
        detail="Host"
      />
      {event.group_name ? (
        <Button title={`In ${event.group_name}`} variant="ghost" icon="people-outline" onPress={() => router.push({ pathname: '/group/[id]', params: { id: event.group_id! } })} />
      ) : null}
      {event.description ? <AppText selectable>{event.description}</AppText> : null}
      <AppText muted>
        {event.going_count} going{event.capacity ? ` of ${event.capacity} places` : ''} · {event.interested_count} interested
      </AppText>
      {actionError ? <Banner message={actionError} /> : null}

      {open && !event.is_host ? (
        <View style={{ gap: Spacing.sm }}>
          {event.my_status === 'invited' ? <AppText>You've been invited. Will you go?</AppText> : null}
          <ChoiceChips
            label="Your response"
            options={[
              { value: 'going' as Choice, label: 'Going' },
              { value: 'interested' as Choice, label: 'Interested' },
              { value: 'not_going' as Choice, label: 'Can\'t go' },
            ]}
            value={myChoice ?? ('' as Choice)}
            disabled={busy}
            onChange={(s) => rsvp(s, event.my_hidden ?? false)}
          />
          {myChoice === 'going' || myChoice === 'interested' ? (
            <ToggleRow
              label="Hide me from the attendee list"
              description="The host still sees you. Others going see only the count."
              value={event.my_hidden ?? false}
              disabled={busy}
              onChange={(hide) => rsvp(myChoice, hide)}
            />
          ) : null}
        </View>
      ) : null}

      {open && (event.is_host || (event.my_status === 'going' && event.visibility !== 'invite_only')) ? (
        <Button title="Invite connections" icon="person-add-outline" variant="secondary" onPress={() => router.push({ pathname: '/invite', params: { kind: 'event', id } })} />
      ) : null}
      {event.is_host && open ? (
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Edit" variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: '/event-form', params: { id } })} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Cancel event" variant="danger" onPress={confirmCancel} />
          </View>
        </View>
      ) : null}

      <AppText variant="subtitle">Who's coming</AppText>
      {attendees.length ? (
        attendees.map((a) => <PersonRow key={a.user_id} person={{ ...a, id: a.user_id }} detail={a.status === 'going' ? 'Going' : 'Interested'} />)
      ) : (
        <AppText variant="caption" muted>
          {event.is_host || event.my_status === 'going' ? 'Nobody has responded yet.' : 'The attendee list is visible to people who are going.'}
        </AppText>
      )}
    </Screen>
  );
}
