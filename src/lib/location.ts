// Location reporting for nearby discovery and proximity alerts.
//
// Design (see docs/LOCATION.md):
//  * Foreground: when Discover/Map opens, take one balanced-accuracy fix and
//    report it. Needs only "while using the app" permission.
//  * Background (only when proximity alerts are on and "Always"/background
//    permission is granted):
//      - a distance-based location task (≥100 m moves, at most every ~2 min
//        on Android) at balanced accuracy, which is cheap on battery;
//      - a 250 m geofence around the last report as a backstop: leaving it
//        wakes the app even when iOS has suspended normal updates.
//  * The server decides everything else (eligibility, freshness, matching).
//    The phone never learns anyone else's position.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export const LOCATION_TASK = 'nearmalayali-location-updates';
export const GEOFENCE_TASK = 'nearmalayali-geofence';
const FENCE_ID = 'nearmalayali-last-report';
const FENCE_RADIUS_M = 250;

export type ReportResult =
  | { stored: true; alerts: number }
  | { stored: false; reason: 'NOT_DISCOVERABLE' | 'LOW_ACCURACY' | 'STALE' | 'OUT_OF_ORDER' | 'IMPLAUSIBLE_MOVEMENT' | string };

export async function reportLocation(loc: Location.LocationObject): Promise<ReportResult> {
  const { data, error } = await supabase.rpc('report_location', {
    p_lat: loc.coords.latitude,
    p_lng: loc.coords.longitude,
    // A missing accuracy is treated as very poor, so it can't trigger alerts.
    p_accuracy_m: loc.coords.accuracy ?? 9999,
    p_is_mocked: loc.mocked ?? false,
    p_recorded_at: new Date(loc.timestamp).toISOString(),
  });
  if (error) throw error;
  return data as ReportResult;
}

/** One foreground fix + report. Throws if permission is missing. */
export async function reportCurrentLocation(): Promise<ReportResult> {
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return reportLocation(loc);
}

export interface PermissionState {
  foreground: Location.PermissionStatus;
  background: Location.PermissionStatus;
  canAskForeground: boolean;
  canAskBackground: boolean;
  servicesEnabled: boolean;
}

export async function getPermissionState(): Promise<PermissionState> {
  const [fg, bg, services] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Location.hasServicesEnabledAsync(),
  ]);
  return {
    foreground: fg.status,
    background: bg.status,
    canAskForeground: fg.canAskAgain,
    canAskBackground: bg.canAskAgain,
    servicesEnabled: services,
  };
}

export async function requestForegroundPermission(): Promise<boolean> {
  return (await Location.requestForegroundPermissionsAsync()).granted;
}

/** Must be called after foreground permission is granted. */
export async function requestBackgroundPermission(): Promise<boolean> {
  return (await Location.requestBackgroundPermissionsAsync()).granted;
}

async function startFence(lat: number, lng: number) {
  await Location.startGeofencingAsync(GEOFENCE_TASK, [
    { identifier: FENCE_ID, latitude: lat, longitude: lng, radius: FENCE_RADIUS_M, notifyOnEnter: false, notifyOnExit: true },
  ]);
}

async function stopIfStarted() {
  if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK)) {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  if (await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK)) {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
}

/**
 * Starts or stops background reporting to match the member's settings.
 * Returns whether background reporting is running afterwards.
 */
export async function syncBackgroundTracking(opts: { wantsAlerts: boolean }): Promise<boolean> {
  const perms = await getPermissionState();
  const allowed = opts.wantsAlerts && perms.background === 'granted' && perms.servicesEnabled;
  if (!allowed) {
    await stopIfStarted();
    return false;
  }
  if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 100,
      timeInterval: 120_000, // Android: no more often than every 2 minutes
      deferredUpdatesInterval: 60_000,
      deferredUpdatesDistance: 100,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'Proximity alerts are on',
        notificationBody: 'NearMalayali checks occasionally for Malayalis nearby. Tap to change.',
        notificationColor: '#0B6E4F',
        killServiceOnDestroy: false,
      },
    });
  }
  return true;
}

/** Stop everything (sign-out, discovery off). */
export async function stopAllTracking(): Promise<void> {
  await stopIfStarted().catch(() => undefined);
  await supabase.rpc('clear_my_location').then(
    () => undefined,
    () => undefined,
  );
}

// ---------------------------------------------------------------------------
// Background task definitions. Must run at module load (imported from the
// root layout) so the OS can deliver events after relaunching the app.
// ---------------------------------------------------------------------------
async function handleBackgroundFix(loc: Location.LocationObject) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    await stopIfStarted();
    return;
  }
  try {
    const result = await reportLocation(loc);
    if (!result.stored && result.reason === 'NOT_DISCOVERABLE') {
      // Discovery was turned off elsewhere (e.g. another device): stop.
      await stopIfStarted();
      return;
    }
    if (result.stored) await startFence(loc.coords.latitude, loc.coords.longitude);
  } catch {
    // Offline or rate limited: the next movement will try again. Nothing is
    // queued, because an old position is useless for proximity.
  }
}

if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    // Only the newest fix matters.
    const latest = data.locations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    await handleBackgroundFix(latest);
  });

  TaskManager.defineTask<{ eventType: Location.GeofencingEventType }>(GEOFENCE_TASK, async ({ data, error }) => {
    if (error || data?.eventType !== Location.GeofencingEventType.Exit) return;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await handleBackgroundFix(loc);
    } catch {
      // Ignore; the next wake-up will retry.
    }
  });
}
