// Turning a town name into coordinates for "explore another town".
//
// Uses the phone's own geocoder (Apple on iOS, Google Play services on
// Android). Android only allows that after location permission is granted, so
// without it we fall back to OpenStreetMap's Nominatim service, which is free
// for low volumes (max 1 request/second; see docs/LOCATION.md for swapping in
// a paid geocoder at scale). Only the typed town name is sent, never the
// member's own location.
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface Place {
  lat: number;
  lng: number;
  label: string;
}

async function nominatim(query: string): Promise<Place | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'NearMalayali/1.0 (mobile app)', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!rows[0]) return null;
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon), label: rows[0].display_name.split(',').slice(0, 2).join(',') };
}

export async function findPlace(query: string): Promise<Place | null> {
  const q = query.trim();
  if (q.length < 2) return null;

  const canUseDevice =
    Platform.OS === 'ios' || (await Location.getForegroundPermissionsAsync()).status === 'granted';
  if (canUseDevice) {
    try {
      const results = await Location.geocodeAsync(q);
      if (results[0]) return { lat: results[0].latitude, lng: results[0].longitude, label: q };
      return null;
    } catch {
      // fall through to Nominatim
    }
  }
  return nominatim(q);
}

/** Map region span → search radius in metres, clamped to what the server allows. */
export function radiusForSpan(latitudeDelta: number): number {
  const metres = (latitudeDelta * 111_000) / 2;
  return Math.round(Math.min(50_000, Math.max(1_000, metres)));
}
