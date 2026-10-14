// Create an event (?group=<id> for a group event) or edit yours (?id=<event>).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { DateTimeField } from '@/components/date-time-field';
import { AppText, Banner, Button, ChoiceChips, ErrorView, LoadingView, Screen, TextField } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { createEvent, eventDetails, type EventInput, type EventVisibility, updateEvent } from '@/lib/community';
import { friendlyError } from '@/lib/errors';

type FormValues = Omit<EventInput, 'startsAt'> & { startsAt: Date | null };

export default function EventForm() {
  const { id, group } = useLocalSearchParams<{ id?: string; group?: string }>();
  const load = useCallback(() => (id ? eventDetails(id) : Promise.resolve(null)), [id]);
  const { data: existing, error, reload } = useAsync(load);
  const [form, setForm] = useState<Partial<FormValues>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error && existing === undefined) return <ErrorView message={friendlyError(error)} onRetry={reload} />;
  if (existing === undefined) return <LoadingView />;
  if (id && (!existing || !existing.is_host)) return <ErrorView message="Only the host can edit this event." />;

  const v: FormValues = {
    title: form.title ?? existing?.title ?? '',
    description: form.description ?? existing?.description ?? '',
    startsAt: form.startsAt ?? (existing ? new Date(existing.starts_at) : null),
    endsAt: form.endsAt !== undefined ? form.endsAt : existing?.ends_at ? new Date(existing.ends_at) : null,
    venueName: form.venueName ?? existing?.venue_name ?? '',
    address: form.address ?? existing?.address ?? '',
    addressVisibility: form.addressVisibility ?? existing?.address_visibility ?? 'attendees',
    region: form.region ?? existing?.region ?? '',
    onlineUrl: form.onlineUrl ?? existing?.online_url ?? '',
    visibility: form.visibility ?? existing?.visibility ?? (group ? 'group' : 'public'),
    groupId: group ?? existing?.group_id ?? null,
    capacity: form.capacity !== undefined ? form.capacity : existing?.capacity ?? null,
  };
  const set = (patch: Partial<FormValues>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!v.startsAt) return;
    const input: EventInput = { ...v, startsAt: v.startsAt };
    setBusy(true);
    setActionError(null);
    try {
      if (id) {
        await updateEvent(id, input);
        router.back();
      } else {
        const newId = await createEvent(input);
        router.replace({ pathname: '/event/[id]', params: { id: newId } });
      }
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <TextField label="Event name" value={v.title} onChangeText={(t) => set({ title: t })} maxLength={120} placeholder="e.g. Onam celebration" />
      <DateTimeField label="Starts" value={v.startsAt} onChange={(d) => set({ startsAt: d })} minimumDate={new Date()} />
      <DateTimeField
        label="Ends (optional)"
        value={v.endsAt}
        onChange={(d) => set({ endsAt: d })}
        onClear={() => set({ endsAt: null })}
        minimumDate={v.startsAt ?? new Date()}
        placeholder="No end time"
      />
      <TextField label="Venue name" value={v.venueName} onChangeText={(t) => set({ venueName: t })} maxLength={120} />
      <TextField label="Address" value={v.address} onChangeText={(t) => set({ address: t })} maxLength={300} />
      <ChoiceChips
        label="Who sees the address and online link?"
        options={[
          { value: 'attendees', label: 'People going' },
          { value: 'everyone', label: 'Everyone who sees the event' },
        ]}
        value={v.addressVisibility}
        onChange={(a) => set({ addressVisibility: a })}
      />
      <TextField label="Town or region" value={v.region} onChangeText={(t) => set({ region: t })} maxLength={80} placeholder="Helps people nearby find it" />
      <TextField
        label="Online link (optional)"
        value={v.onlineUrl}
        onChangeText={(t) => set({ onlineUrl: t })}
        autoCapitalize="none"
        keyboardType="url"
        placeholder="https://"
      />
      <TextField
        label="Details"
        value={v.description}
        onChangeText={(t) => set({ description: t })}
        multiline
        maxLength={5000}
        style={{ minHeight: 100, textAlignVertical: 'top' }}
      />
      <TextField
        label="Capacity (optional)"
        value={v.capacity ? String(v.capacity) : ''}
        onChangeText={(t) => set({ capacity: t.trim() ? Math.max(1, parseInt(t.replace(/\D/g, ''), 10) || 1) : null })}
        keyboardType="number-pad"
        placeholder="No limit"
      />
      {!id && !group ? (
        <ChoiceChips
          label="Who can see this event?"
          options={[
            { value: 'public' as EventVisibility, label: 'Everyone' },
            { value: 'connections' as EventVisibility, label: 'Connections' },
            { value: 'invite_only' as EventVisibility, label: 'Invited only' },
          ]}
          value={v.visibility}
          onChange={(vis) => set({ visibility: vis })}
        />
      ) : group ? (
        <AppText muted>This event is visible to the group.</AppText>
      ) : null}
      {actionError ? <Banner message={actionError} /> : null}
      <Button title={id ? 'Save changes' : 'Create event'} loading={busy} disabled={!v.title.trim() || !v.startsAt} onPress={save} />
      {id ? (
        <AppText variant="caption" muted>
          If you change the time or address, people going or interested are notified.
        </AppText>
      ) : null}
    </Screen>
  );
}
