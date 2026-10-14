import { AppText, Banner, Card, ChoiceChips, Divider, ErrorView, LoadingView, Screen, ToggleRow } from '@/components/ui';
import { useSettings } from '@/hooks/use-settings';
import { fetchVisibility, updateVisibility } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import type { ConnectPermission, FieldVisibility, MessagePermission, ProfileVisibility } from '@/lib/types';

const FIELD_OPTIONS: { value: FieldVisibility; label: string }[] = [
  { value: 'public', label: 'Everyone' },
  { value: 'connections', label: 'Connections' },
  { value: 'only_me', label: 'Only me' },
];

const FIELDS: { key: keyof ProfileVisibility; label: string }[] = [
  { key: 'bio', label: 'Bio' },
  { key: 'home_region', label: 'Town or region' },
  { key: 'languages', label: 'Languages' },
  { key: 'interests', label: 'Interests' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'intro', label: 'Introduction' },
  { key: 'connection_preferences', label: '"Open to" preferences' },
];

const MESSAGE_OPTIONS: { value: MessagePermission; label: string }[] = [
  { value: 'everyone', label: 'Anyone' },
  { value: 'requests', label: 'Others as requests' },
  { value: 'connections_only', label: 'Connections only' },
];

const CONNECT_OPTIONS: { value: ConnectPermission; label: string }[] = [
  { value: 'everyone', label: 'Anyone' },
  { value: 'nobody', label: 'Nobody' },
];

export default function PrivacySettings() {
  const { value, loadError, saveError, reload, update } = useSettings(fetchVisibility, updateVisibility);

  if (loadError) return <ErrorView message={friendlyError(loadError)} onRetry={reload} />;
  if (!value) return <LoadingView />;

  return (
    <Screen edges={['bottom']}>
      {saveError ? <Banner message={saveError} /> : null}
      <AppText muted>
        Your display name, username and photo are visible to signed-in members. Choose who sees everything else. "Everyone" means
        signed-in members only; profiles are never public on the web.
      </AppText>

      <Card>
        <AppText variant="label" muted>
          Profile details
        </AppText>
        {FIELDS.map((f, i) => (
          <ChoiceSection key={f.key} first={i === 0}>
            <ChoiceChips
              label={f.label}
              options={FIELD_OPTIONS}
              value={value[f.key] as FieldVisibility}
              onChange={(v) => update({ [f.key]: v } as Partial<ProfileVisibility>)}
            />
          </ChoiceSection>
        ))}
      </Card>

      <Card>
        <AppText variant="label" muted>
          Contact
        </AppText>
        <ChoiceChips
          label="Who can message you"
          options={MESSAGE_OPTIONS}
          value={value.who_can_message}
          onChange={(v) => update({ who_can_message: v })}
        />
        <Divider />
        <ChoiceChips
          label="Who can send connection requests"
          options={CONNECT_OPTIONS}
          value={value.who_can_connect}
          onChange={(v) => update({ who_can_connect: v })}
        />
        <Divider />
        <ChoiceChips
          label="Who can see your connections"
          options={FIELD_OPTIONS}
          value={value.connections_list}
          onChange={(v) => update({ connections_list: v })}
        />
        <Divider />
        <ChoiceChips
          label="Who can see your groups"
          options={FIELD_OPTIONS}
          value={value.group_memberships}
          onChange={(v) => update({ group_memberships: v })}
        />
        <AppText variant="caption" muted>
          Your groups aren't listed on your profile yet. This choice is saved and will apply when they are.
        </AppText>
      </Card>

      <Card>
        <AppText variant="label" muted>
          Visibility
        </AppText>
        <ToggleRow
          label="Appear in people search"
          description="Members can find you by name or username."
          value={value.searchable}
          onChange={(v) => update({ searchable: v })}
        />
        <Divider />
        <ToggleRow
          label="Send read receipts"
          description="Shows “Seen” in one-to-one chats. Only works when both people have it on."
          value={value.read_receipts}
          onChange={(v) => update({ read_receipts: v })}
        />
        <Divider />
        <ToggleRow
          label="Show when I'm online"
          description="Not yet implemented: online status isn't shown to anyone yet. Your choice is saved for when it is."
          value={value.show_online_status}
          onChange={(v) => update({ show_online_status: v })}
        />
        <Divider />
        <ToggleRow
          label="Show typing indicator"
          description="Not yet implemented: typing isn't shown to anyone yet. Your choice is saved for when it is."
          value={value.typing_indicators}
          onChange={(v) => update({ typing_indicators: v })}
        />
      </Card>
    </Screen>
  );
}

function ChoiceSection({ children, first }: { children: React.ReactNode; first: boolean }) {
  return (
    <>
      {first ? null : <Divider />}
      {children}
    </>
  );
}
