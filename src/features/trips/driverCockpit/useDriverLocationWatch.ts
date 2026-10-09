import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useAppInForeground } from '../../../hooks/useAppInForeground';
import { isForegroundAppState } from '../../liveRide/backgroundLocation/backgroundLocationRules';
import { toLocationUpdatePayload } from '../../liveRide/locationEmit';
import { useRideSocket } from '../../liveRide/socket';

export interface WatchedPosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  mocked?: boolean;
}

export interface DriverLocationWatch {
  currentPosition: WatchedPosition | null;
  locationDenied: boolean;
  // Foreground location permission granted — what the background location
  // task (useDriverBackgroundLocation) waits for, so the driver is only ever
  // asked once, by this watch.
  permissionGranted: boolean;
  lastLocationUpdateAt: string | null;
}

/**
 * Foreground-only GPS watch, active only while `active` (the trip being in
 * progress) is true — used to geofence the stop-level "Arrived" button and to
 * push the driver's position over the live-ride socket for any rider/screen
 * watching this trip. Cleans itself up on unmount and whenever `active`
 * turns false. In the background the driver's location reaches riders
 * through the background location task instead (features/liveRide/
 * backgroundLocation).
 */
export function useDriverLocationWatch(tripId: string, active: boolean): DriverLocationWatch {
  const { emitLocation } = useRideSocket();
  const inForeground = useAppInForeground();
  const [currentPosition, setCurrentPosition] = useState<WatchedPosition | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [lastLocationUpdateAt, setLastLocationUpdateAt] = useState<string | null>(null);
  // Bumped when permission turns out to have been granted in the device
  // settings since it was denied here — restarts the watch below.
  const [permissionRecheck, setPermissionRecheck] = useState(0);

  useEffect(() => {
    // No explicit reset here: when this becomes false, React has already run
    // the previous effect's cleanup below (which removes the subscription) —
    // there's nothing further to synchronize, so this effect run just no-ops.
    if (!active) return;

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!granted) {
        setLocationDenied(true);
        setPermissionGranted(false);
        return;
      }
      setLocationDenied(false);
      setPermissionGranted(true);
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 10 },
        (location) => {
          setCurrentPosition({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            accuracy: location.coords.accuracy,
            mocked: location.mocked,
          });
          setLastLocationUpdateAt(new Date().toISOString());
          // Same fix used for the geofence check above, additionally pushed
          // over the live-ride socket for any rider/screen watching this
          // trip. This effect (and therefore the watch) only runs at all
          // while `active` is true, so no separate check is needed here.
          // The geofence state above takes every fix; emitLocation itself
          // drops fixes while the socket isn't ready and throttles the rest
          // to one per ~4 s (iOS ignores timeInterval and fires every 10 m).
          // Foreground only: in the background the location task posts the
          // driver's fixes over REST, and one source at a time is enough.
          const payload = toLocationUpdatePayload(tripId, location);
          if (payload && isForegroundAppState(AppState.currentState)) emitLocation(payload);
        },
      );
      if (cancelled) subscription?.remove();
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
    // emitLocation is a stable module-level function (socket.ts), so the
    // watch is still recreated only when `active` or the trip changes.
  }, [active, tripId, emitLocation, permissionRecheck]);

  // Denied, then back from the device settings (where the cockpit's warning
  // sends the driver): look again without prompting, and restart the watch
  // if location is allowed now.
  useEffect(() => {
    if (!active || !locationDenied || !inForeground) return;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then(({ granted }) => {
        if (!cancelled && granted) setPermissionRecheck((count) => count + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, locationDenied, inForeground]);

  return { currentPosition, locationDenied, permissionGranted, lastLocationUpdateAt };
}
