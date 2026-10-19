import { useEffect, useRef } from 'react';

import { haversineDistanceMeters, type GeoPoint } from '../../liveRide/geo';

// Automatic arrival (owner decision): within this distance of the current
// stop…
export const AUTO_ARRIVAL_RADIUS_METERS = 50;
// …for this long — so driving past the stop, or a moment at a nearby signal,
// doesn't count…
const AUTO_ARRIVAL_DWELL_MS = 15_000;
// …on a fix accurate enough to tell (accuracy unknown counts as good enough —
// the radius check still applies).
const AUTO_ARRIVAL_MAX_ACCURACY_METERS = 50;

interface Position extends GeoPoint {
  accuracy: number | null;
}

function isAtStop(stop: GeoPoint, position: Position): boolean {
  if (position.accuracy !== null && position.accuracy > AUTO_ARRIVAL_MAX_ACCURACY_METERS) return false;
  return haversineDistanceMeters(position, stop) <= AUTO_ARRIVAL_RADIUS_METERS;
}

/**
 * Marks the driver's arrival at `stop` (the stop they're navigating to — null
 * otherwise) on its own once they've stayed at it for a while: the same
 * ARRIVED a tap on Arrived sends. Watched with a timer rather than per GPS
 * fix, since a parked phone stops reporting new fixes. Fires at most once per
 * stop — if that arrival fails, the Arrived button is still there.
 */
export function useAutoArrival(
  stop: (GeoPoint & { id: string }) | null,
  position: Position | null,
  onArrive: (stopId: string) => void,
): void {
  const atStop = !!stop && !!position && isAtStop(stop, position);
  const stopId = stop?.id ?? null;
  const firedStopIds = useRef(new Set<string>());
  // What the timer re-checks when it fires — the latest values, not the ones
  // from when the driver first got close.
  const latest = useRef({ stop, position, onArrive });
  useEffect(() => {
    latest.current = { stop, position, onArrive };
  });

  useEffect(() => {
    if (!atStop || !stopId || firedStopIds.current.has(stopId)) return;
    const timer = setTimeout(() => {
      const { stop: currentStop, position: currentPosition, onArrive: arrive } = latest.current;
      if (currentStop?.id !== stopId || !currentPosition || !isAtStop(currentStop, currentPosition)) return;
      firedStopIds.current.add(stopId);
      arrive(stopId);
    }, AUTO_ARRIVAL_DWELL_MS);
    return () => clearTimeout(timer);
  }, [atStop, stopId]);
}
