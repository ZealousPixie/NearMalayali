// Post a notice to the community noticeboard.
import { router } from 'expo-router';
import { useState } from 'react';

import { View } from 'react-native';

import { AppText, Banner, Button, ChoiceChips, Chip, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { createNotice, NOTICE_CATEGORIES, type NoticeCategory } from '@/lib/community';
import { friendlyError } from '@/lib/errors';

export default function NoticeForm() {
  const [category, setCategory] = useState<NoticeCategory | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [region, setRegion] = useState('');
  const [days, setDays] = useState<7 | 14 | 30 | 60>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createNotice(category!, title, body, region, days);
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = category !== null && title.trim().length >= 5 && body.trim().length >= 10 && region.trim().length >= 2;

  return (
    <Screen edges={['bottom']}>
      <AppText variant="caption" style={{ fontWeight: '600' }}>
        Category
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
        {NOTICE_CATEGORIES.map((c) => (
          <Chip key={c.value} label={c.label} radio selected={category === c.value} onPress={() => setCategory(c.value)} />
        ))}
      </View>
      <TextField label="Title" value={title} onChangeText={setTitle} maxLength={120} placeholder="e.g. Room for rent near Joondalup station" />
      <TextField
        label="Details"
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={3000}
        style={{ minHeight: 120, textAlignVertical: 'top' }}
        hint="Don't include your phone number or address. People can message you in the app."
      />
      <TextField label="Town or region" value={region} onChangeText={setRegion} maxLength={80} />
      <ChoiceChips
        label="Show for"
        options={[
          { value: 7 as const, label: '1 week' },
          { value: 14 as const, label: '2 weeks' },
          { value: 30 as const, label: '30 days' },
          { value: 60 as const, label: '60 days' },
        ]}
        value={days}
        onChange={setDays}
      />
      {error ? <Banner message={error} /> : null}
      <Button title="Post notice" icon="megaphone-outline" loading={busy} disabled={!ready} onPress={submit} />
      <AppText variant="caption" muted>
        Notices are visible to all members, expire automatically and must follow the community guidelines. NearMalayali doesn't process payments.
      </AppText>
    </Screen>
  );
}
