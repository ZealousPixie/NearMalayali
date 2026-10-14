// Create a group, or edit one you administer (?id=<group>).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { AppText, Banner, Button, ChoiceChips, ErrorView, LoadingView, Screen, TextField } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { createGroup, groupDetails, type GroupPrivacy, updateGroup } from '@/lib/community';
import { friendlyError } from '@/lib/errors';

const PRIVACY_HELP: Record<GroupPrivacy, string> = {
  public: 'Anyone can find and join. Posts are visible to all members of NearMalayali.',
  approval: 'Anyone can find it, but admins approve who joins. Posts are visible to members only.',
  private: 'Hidden from search. People join by invitation from an admin. Posts are visible to members only.',
};

export default function GroupForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const load = useCallback(() => (id ? groupDetails(id) : Promise.resolve(null)), [id]);
  const { data: existing, error, reload } = useAsync(load);
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<GroupPrivacy | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error && existing === undefined) return <ErrorView message={friendlyError(error)} onRetry={reload} />;
  if (existing === undefined) return <LoadingView />;
  if (id && !existing) return <ErrorView message="This group isn't available." />;

  const v = {
    name: name ?? existing?.name ?? '',
    description: description ?? existing?.description ?? '',
    region: region ?? existing?.region ?? '',
    privacy: privacy ?? existing?.privacy ?? 'public',
  };

  async function save() {
    setBusy(true);
    setActionError(null);
    try {
      if (id) {
        await updateGroup(id, v.name, v.description, v.privacy, v.region);
        router.back();
      } else {
        const newId = await createGroup(v.name, v.description, v.privacy, v.region);
        router.replace({ pathname: '/group/[id]', params: { id: newId } });
      }
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <TextField label="Group name" value={v.name} onChangeText={setName} maxLength={80} placeholder="e.g. Malayalis in Perth" />
      <TextField
        label="About"
        value={v.description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
        style={{ minHeight: 100, textAlignVertical: 'top' }}
      />
      <TextField label="Town or region (optional)" value={v.region} onChangeText={setRegion} maxLength={80} />
      <ChoiceChips
        label="Privacy"
        options={[
          { value: 'public', label: 'Public' },
          { value: 'approval', label: 'Approval' },
          { value: 'private', label: 'Private' },
        ]}
        value={v.privacy}
        onChange={setPrivacy}
      />
      <AppText variant="caption" muted>
        {PRIVACY_HELP[v.privacy]}
      </AppText>
      {actionError ? <Banner message={actionError} /> : null}
      <Button title={id ? 'Save changes' : 'Create group'} loading={busy} disabled={v.name.trim().length < 3} onPress={save} />
      {!id ? (
        <AppText variant="caption" muted>
          A group chat is created with the group, and members join it automatically.
        </AppText>
      ) : null}
    </Screen>
  );
}
