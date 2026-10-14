// Write, edit or share a post. ?group=<id> posts into a group,
// ?edit=<id> edits your post's text, ?share=<id> shares a public post.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Banner, Button, ChoiceChips, ErrorView, LoadingView, Screen, TextField } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { createPost, editPost, getPost, groupDetails, pickPostPhotos, type PostVisibility } from '@/lib/community';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/providers/auth-provider';

export default function ComposePost() {
  const { group, edit, share } = useLocalSearchParams<{ group?: string; edit?: string; share?: string }>();
  const { session } = useAuth();
  const c = useTheme();

  const loadContext = useCallback(async () => {
    const [existing, shared, g] = await Promise.all([
      edit ? getPost(edit) : null,
      share ? getPost(share) : null,
      group ? groupDetails(group) : null,
    ]);
    return { existing, shared, group: g };
  }, [edit, share, group]);
  const { data: ctx, error, reload } = useAsync(loadContext);

  const [body, setBody] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Exclude<PostVisibility, 'group'>>('public');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error && !ctx) return <ErrorView message={friendlyError(error)} onRetry={reload} />;
  if (!ctx || !session) return <LoadingView />;
  if ((edit && !ctx.existing) || (share && !ctx.shared) || (group && !ctx.group)) {
    return <ErrorView message="This isn't available any more." />;
  }

  const text = body ?? ctx.existing?.body ?? '';

  async function addPhotos() {
    setActionError(null);
    try {
      const picked = await pickPostPhotos(4 - photos.length);
      setPhotos((p) => [...p, ...picked].slice(0, 4));
    } catch (e) {
      setActionError(friendlyError(e));
    }
  }

  async function submit() {
    setBusy(true);
    setActionError(null);
    try {
      if (edit) {
        await editPost(edit, text);
        router.back();
        return;
      }
      const id = await createPost({
        userId: session!.user.id,
        body: text,
        visibility: group ? 'group' : visibility,
        groupId: group ?? null,
        photos,
        sharedPostId: share ?? null,
      });
      router.replace({ pathname: '/post/[id]', params: { id } });
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const empty = !text.trim() && photos.length === 0 && !share;

  return (
    <Screen edges={['bottom']}>
      {ctx.group ? <AppText muted>Posting in {ctx.group.name}. Only people who can see this group will see it.</AppText> : null}
      {!group && !edit ? (
        <ChoiceChips
          label="Who can see this?"
          options={[
            { value: 'public', label: 'Everyone' },
            { value: 'connections', label: 'Connections' },
          ]}
          value={visibility}
          onChange={setVisibility}
        />
      ) : null}
      <TextField
        label={share ? 'Add a comment (optional)' : 'Post'}
        value={text}
        onChangeText={setBody}
        multiline
        maxLength={5000}
        style={{ minHeight: 140, textAlignVertical: 'top' }}
        placeholder="Share news, ask a question, say hello…"
      />
      {ctx.shared ? (
        <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: Radius.sm, padding: Spacing.sm }}>
          <AppText variant="caption" style={{ fontWeight: '600' }}>
            {ctx.shared.author_name}
          </AppText>
          <AppText numberOfLines={4}>{ctx.shared.body}</AppText>
        </View>
      ) : null}
      {!edit && !share ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
          {photos.map((uri) => (
            <View key={uri}>
              <Image source={{ uri }} style={{ width: 80, height: 80, borderRadius: Radius.sm }} accessibilityLabel="Selected photo" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
                onPress={() => setPhotos((p) => p.filter((x) => x !== uri))}
                style={{ position: 'absolute', top: -8, right: -8, padding: 4 }}>
                <Ionicons name="close-circle" size={24} color={c.danger} />
              </Pressable>
            </View>
          ))}
          {photos.length < 4 ? (
            <Button title="Add photos" variant="secondary" icon="images-outline" onPress={addPhotos} />
          ) : null}
        </View>
      ) : null}
      {photos.length ? (
        <AppText variant="caption" muted>
          Photos are resized and their location data is removed before upload.
        </AppText>
      ) : null}
      {actionError ? <Banner message={actionError} /> : null}
      <Button title={edit ? 'Save' : share ? 'Share' : 'Post'} icon="send" loading={busy} disabled={empty} onPress={submit} />
    </Screen>
  );
}
