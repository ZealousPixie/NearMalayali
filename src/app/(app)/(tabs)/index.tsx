// Discover tab. Stage A ships people search and the discovery status;
// the nearby list arrives in Stage B and is labelled as such.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { PersonRow } from '@/components/person-row';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  NotYetAvailable,
  Screen,
  TextField,
} from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { fetchDiscoverySettings, searchPeople } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import type { DiscoverySettings, PersonSummary } from '@/lib/types';

const PAGE = 20;

export default function Discover() {
  const c = useTheme();
  const [settings, setSettings] = useState<DiscoverySettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const latest = useRef('');

  useFocusEffect(
    useCallback(() => {
      fetchDiscoverySettings()
        .then((s) => {
          setSettings(s);
          setSettingsError(null);
        })
        .catch((e) => setSettingsError(friendlyError(e)));
    }, []),
  );

  const runSearch = useCallback(async (q: string, offset: number) => {
    latest.current = q;
    setSearching(true);
    setSearchError(null);
    try {
      const page = await searchPeople(q, offset, PAGE);
      if (latest.current !== q) return; // a newer search started
      setResults((prev) => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE);
    } catch (e) {
      if (latest.current === q) setSearchError(friendlyError(e));
    } finally {
      if (latest.current === q) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      latest.current = '';
      return;
    }
    const t = setTimeout(() => runSearch(q, 0), 350);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  // Results only apply while a real query is typed.
  const active = query.trim().length >= 2;
  const shown = active ? results : [];

  const paused = settings?.paused_until && new Date(settings.paused_until) > new Date();
  const status = !settings
    ? null
    : !settings.discoverable
      ? 'You are not discoverable. Nobody nearby can find you.'
      : paused
        ? `Discovery paused until ${new Date(settings.paused_until!).toLocaleString()}.`
        : 'You have chosen to be discoverable. Nearby features start working in the next release.';

  return (
    <Screen edges={['top']}>
      <AppText variant="title">Discover</AppText>

      <NotYetAvailable
        stage="Stage B"
        feature="Malayalis near you"
        details="The nearby list, community counts and proximity alerts are being built next. Your discovery choices below are already saved and enforced on the server."
      />

      <Card>
        <AppText variant="label" muted>
          Your discovery status
        </AppText>
        {settingsError ? <Banner message={settingsError} /> : status ? <AppText>{status}</AppText> : <ActivityIndicator color={c.primary} />}
        <Button title="Discovery settings" variant="secondary" icon="options" onPress={() => router.push('/settings/discovery')} />
      </Card>

      <View style={{ gap: Spacing.sm }}>
        <AppText variant="subtitle">Find people</AppText>
        <TextField
          label="Search by name or username"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. anu or @anu_perth"
          returnKeyType="search"
        />
        {searchError && active ? <Banner message={searchError} action={<Button title="Retry" variant="secondary" onPress={() => runSearch(query.trim(), 0)} />} /> : null}
        {shown.map((p, i) => (
          <View key={p.id}>
            {i > 0 ? <Divider /> : null}
            <PersonRow person={p} detail={p.home_region} />
          </View>
        ))}
        {searching && active ? <ActivityIndicator color={c.primary} /> : null}
        {!searching && !searchError && active && results.length === 0 ? (
          <EmptyState icon="search" title="No one found" message="Try a different spelling. Some members choose not to appear in search." />
        ) : null}
        {hasMore && active && !searching ? <Button title="Show more" variant="ghost" onPress={() => runSearch(query.trim(), results.length)} /> : null}
      </View>
    </Screen>
  );
}
