import type { TripManifest } from '../../../api/trips.api';
import { haversineDistanceMeters } from '../../liveRide/geo';
import type { RiderEventOverlay } from '../tripActionOverlay';
import { deriveLegState, type LegState } from './legState';
import { serverClockFrom, type ServerClock } from './noShow';
import {
  mergeArrivedStopIds,
  mergeCockpitRiders,
  mergeDepartedStopIds,
  resolveStops,
  type CockpitRider,
} from './stopProgress';

// Driver must be within this many meters of a stop to confirm arrival there.
// Exported so the leg panel's "Get within Nm…" disabled-reason copy can name
// the same radius this hook gates canConfirmArrival on.
export const ARRIVAL_RADIUS_METERS = 100;

interface UseDriverStopProgressParams {
  manifest: TripManifest | undefined;
  // Device time the manifest response arrived (react-query's dataUpdatedAt) —
  // anchors the server clock its serverNow carries.
  manifestReceivedAt: number;
  // The driver's taps the server hasn't reflected yet (useDriverTripActions).
  optimisticEvents: Record<string, RiderEventOverlay>;
  noShowIds: ReadonlySet<string>;
  arrivedStopIds: ReadonlySet<string>;
  departedStopIds: ReadonlySet<string>;
  currentPosition: { lat: number; lng: number } | null;
}

export interface DriverStopProgress {
  mergedRiders: CockpitRider[];
  // Which stop the driver is on and what they're doing there — see legState.ts.
  leg: LegState;
  // Straight-line distance to the current stop — null without a GPS fix or a current stop.
  currentStopDistanceM: number | null;
  // Navigating, and close enough to the current stop to mark arriving there.
  canConfirmArrival: boolean;
  // Stops the driver has reached — per the server, or tapped on this device.
  arrivedStopIds: Set<string>;
  // null on an older backend (no serverNow) — no-show and wait timing then stay hidden.
  serverClock: ServerClock | null;
}

/**
 * Derives the driver's leg-by-leg progress from the manifest, merged with any
 * not-yet-synced pickup/dropoff/no-show/arrival/departure taps — the state
 * machine behind my-trips/[id].tsx's map and leg panel.
 */
export function useDriverStopProgress({
  manifest,
  manifestReceivedAt,
  optimisticEvents,
  noShowIds,
  arrivedStopIds,
  departedStopIds,
  currentPosition,
}: UseDriverStopProgressParams): DriverStopProgress {
  // Riders with the driver's not-yet-reflected taps merged in. A rider whose
  // pickupStop/dropoffStop is null (legacy data) — or who otherwise doesn't
  // match any current stop — simply isn't grouped under a stop; it never
  // disappears from mergedRiders.
  const mergedRiders = mergeCockpitRiders(manifest?.riders ?? [], { riderEvents: optimisticEvents, noShowIds });
  const routeStops = manifest?.routeStops ?? [];

  // The server's arrivals/departures survive a remount/app restart; the
  // overlay's cover a tap still queued offline or just sent.
  const mergedArrivedStopIds = mergeArrivedStopIds(routeStops, arrivedStopIds);
  const leg = deriveLegState(
    resolveStops(routeStops, mergedRiders),
    mergedArrivedStopIds,
    mergeDepartedStopIds(routeStops, departedStopIds),
  );

  const currentStop = leg.current?.stop ?? null;
  const currentStopDistanceM =
    currentStop && currentPosition
      ? haversineDistanceMeters(currentPosition, { lat: currentStop.lat, lng: currentStop.lng })
      : null;

  return {
    mergedRiders,
    leg,
    currentStopDistanceM,
    canConfirmArrival:
      leg.phase === 'navigating' && currentStopDistanceM !== null && currentStopDistanceM <= ARRIVAL_RADIUS_METERS,
    arrivedStopIds: mergedArrivedStopIds,
    serverClock: serverClockFrom(manifest?.serverNow, manifestReceivedAt),
  };
}
