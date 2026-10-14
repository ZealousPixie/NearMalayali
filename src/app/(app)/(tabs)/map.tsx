// Community map: approximate areas (grid cells with 3+ map-visible members).
// Moving the map only sends the map's centre to the server; it never sends
// or stores the viewer's own location.
import * as Location from 'expo-location';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import MapView, { Circle, Marker, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Banner, Button, TextField } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { type MapCell, mapCells } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { findPlace, radiusForSpan } from '@/lib/geo';

// Perth, WA: a sensible default when we may not use the device location.
const DEFAULT_REGION: Region = { latitude: -31.9523, longitude: 115.8613, latitudeDelta: 0.6, longitudeDelta: 0.6 };
const MAX_DELTA = 0.9; // ~50 km radius, the server's limit

function cellMetres(radius: number) {
  const deg = radius <= 5000 ? 0.01 : radius <= 25000 ? 0.05 : 0.1;
  return deg * 111_000;
}

export default function MapTab() {
  const c = useTheme();
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [cells, setCells] = useState<MapCell[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooWide, setTooWide] = useState(false);
  const [canShowMe, setCanShowMe] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (r: Region) => {
    if (r.latitudeDelta > MAX_DELTA) {
      setTooWide(true);
      setCells([]);
      return;
    }
    setTooWide(false);
    setLoading(true);
    try {
      const result = await mapCells({ lat: r.latitude, lng: r.longitude }, radiusForSpan(r.latitudeDelta));
      setCells(result);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Start near the viewer if they've already allowed location (read on the
  // phone only, never sent), otherwise at the default region.
  useEffect(() => {
    let active = true;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (!active) return;
      setCanShowMe(status === 'granted');
      let start = DEFAULT_REGION;
      if (status === 'granted') {
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        if (last) start = { latitude: last.coords.latitude, longitude: last.coords.longitude, latitudeDelta: 0.3, longitudeDelta: 0.3 };
      }
      if (!active) return;
      mapRef.current?.animateToRegion(start, 0);
      load(start);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  function onRegionChangeComplete(r: Region) {
    setRegion(r);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(r), 600);
  }

  async function goToPlace() {
    setSearching(true);
    setError(null);
    try {
      const place = await findPlace(query);
      if (!place) {
        setError('We couldn\'t find that place.');
      } else {
        mapRef.current?.animateToRegion({ latitude: place.lat, longitude: place.lng, latitudeDelta: 0.3, longitudeDelta: 0.3 }, 600);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSearching(false);
    }
  }

  const radius = radiusForSpan(region.latitudeDelta);
  const total = cells.reduce((n, cell) => n + cell.member_count, 0);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ padding: Spacing.lg, gap: Spacing.sm }}>
        <AppText variant="title">Map</AppText>
        <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <TextField label="Go to a town" value={query} onChangeText={setQuery} placeholder="e.g. Manjimup" onSubmitEditing={goToPlace} returnKeyType="search" />
          </View>
          <View style={{ width: 90 }}>
            <Button title="Go" onPress={goToPlace} loading={searching} disabled={query.trim().length < 2} />
          </View>
        </View>
        {error ? <Banner message={error} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          initialRegion={DEFAULT_REGION}
          onRegionChangeComplete={onRegionChangeComplete}
          showsUserLocation={canShowMe}
          showsMyLocationButton={canShowMe}
          rotateEnabled={false}
          pitchEnabled={false}
          accessibilityLabel="Community map">
          {cells.map((cell) => (
            <Fragment key={`${cell.cell_lat},${cell.cell_lng}`}>
              <Circle
                center={{ latitude: cell.cell_lat, longitude: cell.cell_lng }}
                radius={cellMetres(radius) / 2}
                fillColor="rgba(11,110,79,0.18)"
                strokeColor="rgba(11,110,79,0.6)"
              />
              <Marker
                coordinate={{ latitude: cell.cell_lat, longitude: cell.cell_lng }}
                accessibilityLabel={`${cell.member_count} members in this area`}
                tracksViewChanges={false}>
                <View style={{ backgroundColor: c.primary, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <AppText style={{ color: c.primaryText, fontWeight: '700' }}>{cell.member_count}</AppText>
                </View>
              </Marker>
            </Fragment>
          ))}
        </MapView>
        <View
          style={{
            position: 'absolute',
            left: Spacing.lg,
            right: Spacing.lg,
            bottom: Spacing.lg,
            backgroundColor: c.surface,
            borderRadius: Radius.md,
            padding: Spacing.md,
            gap: 4,
            borderWidth: 1,
            borderColor: c.border,
          }}>
          {loading ? (
            <ActivityIndicator color={c.primary} />
          ) : tooWide ? (
            <AppText>Zoom in to see the community (up to about 50 km across).</AppText>
          ) : cells.length === 0 ? (
            <AppText>No areas to show here yet. Areas appear once at least 3 members who chose map visibility are nearby.</AppText>
          ) : (
            <AppText>
              {total} members in {cells.length} {cells.length === 1 ? 'area' : 'areas'} on screen
            </AppText>
          )}
          <AppText variant="caption" muted>
            Circles are approximate areas, never exact positions. Browsing never shares your location.
          </AppText>
        </View>
      </View>
    </SafeAreaView>
  );
}
