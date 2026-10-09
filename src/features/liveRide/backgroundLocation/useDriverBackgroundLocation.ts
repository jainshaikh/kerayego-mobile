import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { useAppInForeground } from '../../../hooks/useAppInForeground';
import {
  ensureDriverLocationSharing,
  getBackgroundLocationStatus,
  stopDriverLocationSharingForTrip,
  subscribeBackgroundLocationStatus,
} from './driverLocationSharing';

// Why riders may stop getting the driver's location once the driver leaves
// the app: location permission is off, background updates couldn't start
// (retryable), or this build has no background location support at all.
export type BackgroundLocationWarning = 'permission' | 'start_failed' | 'unavailable';

export interface DriverBackgroundLocation {
  warning: BackgroundLocationWarning | null;
  // Tries to start background sharing again (after 'start_failed').
  retry: () => void;
}

interface UseDriverBackgroundLocationParams {
  tripId: string;
  userId: string | undefined;
  // The SERVER's status is IN_PROGRESS (not an optimistic offline start):
  // the location endpoint answers 409 until it is.
  serverInProgress: boolean;
  // The trip has ended for this driver — End ride (synced or queued), or a
  // server status past IN_PROGRESS.
  tripOver: boolean;
  // From the cockpit's foreground watch (useDriverLocationWatch), which owns
  // the permission prompt.
  permissionGranted: boolean;
  locationDenied: boolean;
}

/**
 * The driver cockpit's side of background location sharing
 * (driverLocationSharing.ts): starts it once the server has confirmed the trip
 * IN_PROGRESS and location is allowed — from the foreground, and again on
 * every return to it (a no-op while it's running) — and stops it when the trip
 * is over. Leaving the screen doesn't stop it: the trip is still in progress,
 * and the active-ride lock brings the driver back here.
 */
export function useDriverBackgroundLocation({
  tripId,
  userId,
  serverInProgress,
  tripOver,
  permissionGranted,
  locationDenied,
}: UseDriverBackgroundLocationParams): DriverBackgroundLocation {
  const inForeground = useAppInForeground();
  const status = useSyncExternalStore(
    subscribeBackgroundLocationStatus,
    getBackgroundLocationStatus,
    getBackgroundLocationStatus,
  );
  const [retryCount, setRetryCount] = useState(0);

  const shouldShare = Platform.OS !== 'web' && serverInProgress && !tripOver && !!userId && permissionGranted;

  useEffect(() => {
    // Android won't start the foreground service from the background — wait
    // for the app to come back.
    if (!shouldShare || !inForeground || !userId) return;
    void ensureDriverLocationSharing(tripId, userId);
  }, [shouldShare, inForeground, tripId, userId, retryCount]);

  useEffect(() => {
    if (!tripOver) return;
    void stopDriverLocationSharingForTrip(tripId, 'trip_ended');
  }, [tripOver, tripId]);

  const failedHere = status.state === 'failed' && status.tripId === tripId;
  let warning: BackgroundLocationWarning | null = null;
  if (Platform.OS !== 'web' && !tripOver) {
    if (locationDenied) warning = 'permission';
    else if (failedHere) warning = status.reason;
  }

  return { warning, retry: () => setRetryCount((count) => count + 1) };
}
