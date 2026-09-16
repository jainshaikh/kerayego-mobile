import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
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
  lastLocationUpdateAt: string | null;
}

/**
 * Foreground-only GPS watch, active only while `active` (the trip being in
 * progress) is true — used to geofence the stop-level "Arrived" button and to
 * push the driver's position over the live-ride socket for any rider/screen
 * watching this trip. Cleans itself up on unmount and whenever `active`
 * turns false.
 */
export function useDriverLocationWatch(tripId: string, active: boolean): DriverLocationWatch {
  const { emitLocation } = useRideSocket();
  const [currentPosition, setCurrentPosition] = useState<WatchedPosition | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [lastLocationUpdateAt, setLastLocationUpdateAt] = useState<string | null>(null);

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
        return;
      }
      setLocationDenied(false);
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
          emitLocation({
            tripId,
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            headingDeg: location.coords.heading ?? undefined,
            // expo-location reports speed in meters/second; the gateway payload is km/h.
            speedKmh: location.coords.speed != null ? location.coords.speed * 3.6 : undefined,
            accuracyM: location.coords.accuracy ?? undefined,
            isMockLocation: location.mocked ?? undefined,
            ts: Date.now(),
          });
        },
      );
      if (cancelled) subscription?.remove();
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
    // emitLocation is intentionally omitted: useRideSocket() returns a new
    // function identity every render (it reads live module state, not a
    // stale closure), so including it here would tear down and recreate the
    // location watch on every render instead of only when `active` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tripId]);

  return { currentPosition, locationDenied, lastLocationUpdateAt };
}
