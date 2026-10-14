// Discover: people around me, exploring another town, and people search.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import { FilterBar, type NearbyFilters, NearbyList } from '@/components/nearby-results';
import { PeopleSearch } from '@/components/people-search';
import { AppText, Banner, Button, Card, ChoiceChips, EmptyState, Screen, TextField } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import {
  areaSummary,
  fetchDiscoverySettings,
  type NearbyPerson,
  nearbyUsers,
  unreadNotificationCount,
} from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatDistance } from '@/lib/format';
import { findPlace, type Place } from '@/lib/geo';
import { getPermissionState, reportCurrentLocation, syncBackgroundTracking } from '@/lib/location';
import type { DiscoverySettings } from '@/lib/types';

const RADII = [100, 250, 500, 1000, 5000, 10000, 25000, 50000];
const AREA_RADII = [5000, 10000, 25000, 50000];
const PAGE = 30;

type NearbyPhase =
  | { kind: 'checking' }
  | { kind: 'off' }
  | { kind: 'paused'; until: Date }
  | { kind: 'needs-permission'; blocked: boolean }
  | { kind: 'services-off' }
  | { kind: 'locating' }
  | { kind: 'ready'; people: NearbyPerson[]; hasMore: boolean }
  | { kind: 'error'; message: string };

export default function Discover() {
  const c = useTheme();
  const [settings, setSettings] = useState<DiscoverySettings | null>(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [filters, setFilters] = useState<NearbyFilters>({ interests: [], preferences: [] });
  const [phase, setPhase] = useState<NearbyPhase>({ kind: 'checking' });
  const [unread, setUnread] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  const effectiveRadius = radius ?? settings?.discovery_radius_m ?? 10000;

  const refresh = useCallback(
    async () => {
      const id = ++requestId.current;
      const stillCurrent = () => id === requestId.current;
      try {
        const [s, perms, count] = await Promise.all([
          fetchDiscoverySettings(),
          getPermissionState(),
          unreadNotificationCount().catch(() => 0),
        ]);
        if (!stillCurrent()) return;
        setSettings(s);
        setUnread(count);
        const r = radius ?? s.discovery_radius_m;
        const f = filters;

        const pausedUntil = s.paused_until ? new Date(s.paused_until) : null;
        // Keep background alerts in step with settings and permissions.
        syncBackgroundTracking({ wantsAlerts: s.discoverable && s.proximity_alerts && !(pausedUntil && pausedUntil > new Date()) }).catch(
          () => undefined,
        );

        if (!s.discoverable) return setPhase({ kind: 'off' });
        if (pausedUntil && pausedUntil > new Date()) return setPhase({ kind: 'paused', until: pausedUntil });
        if (!perms.servicesEnabled) return setPhase({ kind: 'services-off' });
        if (perms.foreground !== 'granted') return setPhase({ kind: 'needs-permission', blocked: !perms.canAskForeground });

        setPhase({ kind: 'locating' });
        const report = await reportCurrentLocation();
        if (!stillCurrent()) return;
        if (!report.stored && report.reason === 'LOW_ACCURACY') {
          return setPhase({ kind: 'error', message: 'We couldn\'t get an accurate enough location. Try again outdoors or with Wi-Fi on.' });
        }
        if (!report.stored && report.reason === 'IMPLAUSIBLE_MOVEMENT') {
          return setPhase({ kind: 'error', message: 'Your location jumped unexpectedly, so we didn\'t use it. Please try again in a few minutes.' });
        }
        const people = await nearbyUsers({ radius: r, interests: f.interests, preferences: f.preferences, limit: PAGE });
        if (!stillCurrent()) return;
        setPhase({ kind: 'ready', people, hasMore: people.length === PAGE });
      } catch (e) {
        if (stillCurrent()) setPhase({ kind: 'error', message: friendlyError(e) });
      }
    },
    [radius, filters],
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function loadMore() {
    if (phase.kind !== 'ready') return;
    setLoadingMore(true);
    try {
      const more = await nearbyUsers({
        radius: effectiveRadius,
        interests: filters.interests,
        preferences: filters.preferences,
        offset: phase.people.length,
        limit: PAGE,
      });
      setPhase({ kind: 'ready', people: [...phase.people, ...more], hasMore: more.length === PAGE });
    } catch (e) {
      setPhase({ kind: 'error', message: friendlyError(e) });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="title">Discover</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          onPress={() => router.push('/notifications')}
          style={{ padding: Spacing.sm }}>
          <Ionicons name="notifications-outline" size={26} color={c.text} />
          {unread > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                minWidth: 18,
                height: 18,
                borderRadius: Radius.pill,
                backgroundColor: c.danger,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 4,
              }}>
              <AppText variant="caption" style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                {unread > 99 ? '99+' : unread}
              </AppText>
            </View>
          ) : null}
        </Pressable>
      </View>

      <Card>
        <AppText variant="subtitle">Around you</AppText>
        <NearbyBody phase={phase} onRetry={() => refresh()} />
        {phase.kind === 'ready' || phase.kind === 'locating' || (phase.kind === 'error' && settings?.discoverable) ? (
          <>
            <ChoiceChips
              options={RADII.map((r) => ({ value: r, label: formatDistance(r) }))}
              value={effectiveRadius}
              // Changing these re-runs refresh via useFocusEffect.
              onChange={setRadius}
            />
            <FilterBar
              value={filters}
              onChange={setFilters}
            />
          </>
        ) : null}
        {phase.kind === 'ready' ? (
          phase.people.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title={`No one within ${formatDistance(effectiveRadius)} right now`}
              message="Only members who chose to be discoverable and were active recently appear here. Try a larger distance, explore a nearby town, or check back later."
            />
          ) : (
            <>
              <AppText muted>
                {phase.hasMore ? `${phase.people.length}+` : phase.people.length}{' '}
                {phase.people.length === 1 ? 'member' : 'members'} within {formatDistance(effectiveRadius)}
              </AppText>
              <NearbyList people={phase.people} showDistance />
              {phase.hasMore ? <Button title="Show more" variant="ghost" onPress={loadMore} loading={loadingMore} /> : null}
            </>
          )
        ) : null}
      </Card>

      <AreaExplorer />

      <Card>
        <PeopleSearch />
      </Card>
    </Screen>
  );
}

function NearbyBody({ phase, onRetry }: { phase: NearbyPhase; onRetry: () => void }) {
  const c = useTheme();
  switch (phase.kind) {
    case 'checking':
    case 'locating':
      return (
        <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
          <ActivityIndicator color={c.primary} />
          <AppText muted>{phase.kind === 'locating' ? 'Finding people near you…' : 'Checking your settings…'}</AppText>
        </View>
      );
    case 'off':
      return (
        <>
          <AppText muted>
            You're not discoverable, so you can't see or be seen by people nearby. You can still explore towns and search by name.
          </AppText>
          <Button title="Turn on discovery" icon="navigate" onPress={() => router.push('/settings/discovery')} />
        </>
      );
    case 'paused':
      return (
        <>
          <AppText muted>Discovery is paused until {phase.until.toLocaleString()}.</AppText>
          <Button title="Discovery settings" variant="secondary" onPress={() => router.push('/settings/discovery')} />
        </>
      );
    case 'services-off':
      return <Banner tone="warning" message="Location services are switched off on this phone. Turn them on in your phone's settings." />;
    case 'needs-permission':
      return (
        <>
          <AppText muted>Allow location access while using the app to see Malayalis around you.</AppText>
          {phase.blocked ? (
            <Button title="Open Settings" onPress={() => Linking.openSettings()} />
          ) : (
            <Button title="Allow location" icon="navigate" onPress={() => router.push({ pathname: '/location-permission', params: { purpose: 'nearby' } })} />
          )}
        </>
      );
    case 'error':
      return <Banner message={phase.message} action={<Button title="Try again" variant="secondary" onPress={onRetry} />} />;
    default:
      return null;
  }
}

function AreaExplorer() {
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [radius, setRadius] = useState(10000);
  const [people, setPeople] = useState<NearbyPerson[] | null>(null);
  const [count, setCount] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(p: Place, r: number) {
    setBusy(true);
    setError(null);
    try {
      const [summary, list] = await Promise.all([areaSummary(p, r), nearbyUsers({ radius: r, center: p, limit: PAGE })]);
      setCount(summary.count);
      setPeople(list);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const found = await findPlace(query);
      if (!found) {
        setPlace(null);
        setPeople(null);
        setError('We couldn\'t find that place. Try adding the state or country, e.g. "Bunbury, WA".');
        setBusy(false);
        return;
      }
      setPlace(found);
      await load(found, radius);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Card>
      <AppText variant="subtitle">Explore a town</AppText>
      <AppText variant="caption" muted>
        See the Malayali community anywhere. Looking around a town never shares your own location.
      </AppText>
      <TextField label="Town or city" value={query} onChangeText={setQuery} placeholder="e.g. Bunbury, WA" returnKeyType="search" onSubmitEditing={search} />
      <ChoiceChips
        options={AREA_RADII.map((r) => ({ value: r, label: formatDistance(r) }))}
        value={radius}
        onChange={(r) => {
          setRadius(r);
          if (place) load(place, r);
        }}
      />
      <Button title="Explore" icon="search" onPress={search} loading={busy} disabled={query.trim().length < 2} />
      {error ? <Banner message={error} /> : null}
      {place && people && !busy ? (
        <View style={{ gap: Spacing.sm }}>
          <AppText style={{ fontWeight: '600' }}>
            {count == null ? 'Fewer than 3' : count} discoverable {count === 1 ? 'member' : 'members'} around {place.label} in the last day
          </AppText>
          <AppText variant="caption" muted>
            People listed were near here recently; they aren't necessarily there now.
          </AppText>
          {people.length ? <NearbyList people={people} showDistance={false} /> : null}
        </View>
      ) : null}
    </Card>
  );
}
