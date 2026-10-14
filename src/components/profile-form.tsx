// Profile fields shared by onboarding step 2 and Edit profile.
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import {
  AppText,
  Avatar,
  Banner,
  Button,
  Card,
  ErrorView,
  LoadingView,
  MultiChips,
  TextField,
} from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { fetchOwnDetails, updateOwnDetails, updateOwnProfile } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { type ImageKind, pickImage, publicImageUrl, removeProfileImage, uploadProfileImage } from '@/lib/media';
import { CONNECTION_PREFERENCES, type ProfileDetails } from '@/lib/types';
import { parseTags } from '@/lib/validation';
import { useAuth } from '@/providers/auth-provider';

const LANGUAGE_OPTIONS = ['Malayalam', 'English', 'Hindi', 'Tamil', 'Arabic', 'Kannada'].map((l) => ({ value: l, label: l }));

interface ProfileFormProps {
  submitLabel: string;
  onSaved: () => void;
  displayNameForAvatar: string;
  showCover?: boolean;
}

const KNOWN_LANGUAGES = new Set(LANGUAGE_OPTIONS.map((o) => o.value));

export function ProfileForm(props: ProfileFormProps) {
  const { data, error, reload } = useAsync<ProfileDetails>(fetchOwnDetails);
  if (!data && error) return <ErrorView message={friendlyError(error)} onRetry={reload} />;
  if (!data) return <LoadingView />;
  return <ProfileFields {...props} initial={data} />;
}

function ProfileFields({
  submitLabel,
  onSaved,
  displayNameForAvatar,
  showCover = false,
  initial,
}: ProfileFormProps & { initial: ProfileDetails }) {
  const c = useTheme();
  const { session, profile, refreshProfile } = useAuth();
  const userId = session?.user.id ?? '';
  const [bio, setBio] = useState(initial.bio);
  const [region, setRegion] = useState(initial.home_region);
  const [languages, setLanguages] = useState<string[]>(initial.languages.filter((l) => KNOWN_LANGUAGES.has(l)));
  const [otherLanguages, setOtherLanguages] = useState(initial.languages.filter((l) => !KNOWN_LANGUAGES.has(l)).join(', '));
  const [interests, setInterests] = useState(initial.interests.join(', '));
  const [occupation, setOccupation] = useState(initial.occupation);
  const [intro, setIntro] = useState(initial.intro);
  const [prefs, setPrefs] = useState<string[]>(initial.connection_preferences);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<ImageKind | null>(null);

  async function changeImage(kind: ImageKind) {
    setError(null);
    try {
      const uri = await pickImage(kind);
      if (!uri) return;
      setUploading(kind);
      const previous = kind === 'avatar' ? profile?.avatar_path : profile?.cover_path;
      const path = await uploadProfileImage(userId, uri, kind);
      await updateOwnProfile(kind === 'avatar' ? { avatar_path: path } : { cover_path: path });
      if (previous) await removeProfileImage(previous).catch(() => undefined);
      await refreshProfile();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(
        msg === 'PHOTO_PERMISSION_DENIED'
          ? 'Allow photo access in Settings to choose a picture.'
          : msg === 'IMAGE_TOO_LARGE'
            ? 'That image is too large. Please choose another.'
            : friendlyError(e),
      );
    } finally {
      setUploading(null);
    }
  }

  function removeImage(kind: ImageKind) {
    const path = kind === 'avatar' ? profile?.avatar_path : profile?.cover_path;
    if (!path) return;
    Alert.alert('Remove photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await updateOwnProfile(kind === 'avatar' ? { avatar_path: null } : { cover_path: null });
            await removeProfileImage(path).catch(() => undefined);
            await refreshProfile();
          } catch (e) {
            setError(friendlyError(e));
          }
        },
      },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateOwnDetails({
        bio: bio.trim(),
        home_region: region.trim(),
        languages: [...languages, ...parseTags(otherLanguages, 10 - languages.length)],
        interests: parseTags(interests, 20),
        occupation: occupation.trim(),
        intro: intro.trim(),
        connection_preferences: prefs,
      });
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  const coverUrl = publicImageUrl(profile?.cover_path);

  return (
    <View style={{ gap: Spacing.lg }}>
      {error ? <Banner message={error} /> : null}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.lg }}>
          <Avatar path={profile?.avatar_path} name={displayNameForAvatar} size={72} />
          <View style={{ flex: 1, gap: Spacing.sm }}>
            <Button
              title={profile?.avatar_path ? 'Change photo' : 'Add a photo'}
              variant="secondary"
              icon="camera"
              loading={uploading === 'avatar'}
              onPress={() => changeImage('avatar')}
            />
            {profile?.avatar_path ? <Button title="Remove photo" variant="ghost" onPress={() => removeImage('avatar')} /> : null}
          </View>
        </View>
        <AppText variant="caption" muted>
          Photos are resized and location data inside the file is removed before upload.
        </AppText>
      </Card>
      {showCover ? (
        <Card>
          <AppText style={{ fontWeight: '600' }}>Cover photo</AppText>
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={{ width: '100%', aspectRatio: 3, borderRadius: Radius.sm }} contentFit="cover" />
          ) : null}
          <Button
            title={coverUrl ? 'Change cover' : 'Add a cover photo'}
            variant="secondary"
            icon="image"
            loading={uploading === 'cover'}
            onPress={() => changeImage('cover')}
          />
          {coverUrl ? <Button title="Remove cover" variant="ghost" onPress={() => removeImage('cover')} /> : null}
        </Card>
      ) : null}
      <TextField label="Short bio" value={bio} onChangeText={setBio} multiline maxLength={500} placeholder="A little about you" />
      <TextField
        label="Town, city or region"
        value={region}
        onChangeText={setRegion}
        maxLength={80}
        placeholder="e.g. Manjimup, WA"
        hint="A general area only. Never your address."
      />
      <View style={{ gap: Spacing.sm }}>
        <AppText style={{ fontWeight: '600' }}>Languages</AppText>
        <MultiChips options={LANGUAGE_OPTIONS} values={languages} onChange={setLanguages} />
        <TextField label="Other languages" value={otherLanguages} onChangeText={setOtherLanguages} placeholder="Comma separated" />
      </View>
      <TextField
        label="Interests and hobbies"
        value={interests}
        onChangeText={setInterests}
        placeholder="Cricket, cooking, Onam celebrations"
        hint="Comma separated, up to 20."
      />
      <TextField label="Occupation (optional)" value={occupation} onChangeText={setOccupation} maxLength={80} />
      <TextField
        label="Introduction (optional)"
        value={intro}
        onChangeText={setIntro}
        multiline
        maxLength={300}
        placeholder="e.g. New to the area, would love to meet families nearby"
      />
      <View style={{ gap: Spacing.sm }}>
        <AppText style={{ fontWeight: '600' }}>Open to</AppText>
        <MultiChips options={CONNECTION_PREFERENCES} values={prefs} onChange={setPrefs} />
      </View>
      <Button title={submitLabel} onPress={save} loading={saving} />
      <AppText variant="caption" muted style={{ color: c.textSecondary }}>
        You control who sees each field in Settings › Privacy.
      </AppText>
    </View>
  );
}
