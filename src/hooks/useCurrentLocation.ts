import { useCallback, useState } from 'react';
import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

// Shared by any "near me" filter (vehicles, providers) — requests foreground
// location permission only when the user actually taps the button, never earlier.
export function useCurrentLocation() {
  const [coords, setCoords] = useState<Coords | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestLocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied.');
        return undefined;
      }

      let position: Location.LocationObject;
      try {
        // High accuracy prioritizes the GPS provider — Balanced can fall back to
        // network-based positioning, which emulators don't meaningfully simulate.
        position = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
        ]);
      } catch (freshFixError) {
        console.warn('[useCurrentLocation] getCurrentPositionAsync failed, trying last known position:', freshFixError);
        // Reject anything older than a minute — a stale cached fix (e.g. an
        // emulator's default location from boot) is worse than a clear error.
        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
        if (!lastKnown) throw freshFixError;
        position = lastKnown;
      }

      const next: Coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCoords(next);
      return next;
    } catch (err) {
      console.warn('[useCurrentLocation] failed to get location:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError(`Couldn't get your location (${message}).`);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearLocation = useCallback(() => {
    setCoords(undefined);
    setError(null);
  }, []);

  // Lets a typed/selected place (Places autocomplete) populate the same
  // "active location" the GPS-based requestLocation() does — the nearby
  // query and NearMeControl's active state don't care which source set it.
  const setManualLocation = useCallback((lat: number, lng: number) => {
    setError(null);
    setCoords({ lat, lng });
  }, []);

  return { coords, loading, error, requestLocation, clearLocation, setManualLocation };
}
