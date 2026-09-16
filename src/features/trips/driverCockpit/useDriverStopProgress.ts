import { useEffect, useRef, useState } from 'react';
import { geoApi, type RouteDirections } from '../../../api/geo.api';
import type { ManifestRider, ManifestRouteStop, TripManifest } from '../../../api/trips.api';
import { haversineDistanceMeters } from '../../liveRide/geo';
import { PickupSource } from '../../../types/enums';

// Driver must be within this many meters of a stop to confirm arrival there.
// Exported so DriverLiveCockpit's "Get within Nm…" disabled-reason copy can
// name the same radius this hook gates canConfirmArrival on.
export const ARRIVAL_RADIUS_METERS = 100;

export interface StopResolution {
  stop: ManifestRouteStop;
  riders: ManifestRider[];
  resolved: boolean;
}

interface UseDriverStopProgressParams {
  manifest: TripManifest | undefined;
  optimisticEvents: Record<string, { pickupConfirmedAt?: string; droppedOffAt?: string }>;
  currentPosition: { lat: number; lng: number } | null;
  active: boolean;
}

export interface DriverStopProgress {
  mergedRiders: ManifestRider[];
  stopResolutions: StopResolution[];
  nextStop: ManifestRouteStop | null;
  nextStopDistanceM: number | null;
  canConfirmArrival: boolean;
  selectedStopId: string | null;
  setSelectedStopId: (id: string) => void;
  previewStop: ManifestRouteStop | null;
  routeDirections: RouteDirections | null;
}

/**
 * Derives the driver's stop-by-stop progress from the manifest (merged with
 * any not-yet-synced optimistic pickup/dropoff events), tracks which stop is
 * currently previewed on the map, and fetches turn-by-turn directions for the
 * previewed stop's leg. This is the state machine behind my-trips/[id].tsx's
 * Stops/Riders tabs and map overlay.
 */
export function useDriverStopProgress({
  manifest,
  optimisticEvents,
  currentPosition,
  active,
}: UseDriverStopProgressParams): DriverStopProgress {
  // Which stop's route is currently PREVIEWED on the map — defaults to (and
  // auto-follows) nextStop, but the driver can tap a different stop's card in
  // the Stops tab (or a pin on the map) to preview the route there instead.
  // This is a purely visual/non-destructive preview: it drives ONLY the map
  // polyline/next-stop-banner below, never which stop an "Arrived" tap
  // confirms — that always stays tied to nextStop itself.
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  // The nextStop id selectedStopId was last auto-synced against — see the
  // render-time sync below for how this drives "auto-track nextStop by default".
  const [syncedNextStopId, setSyncedNextStopId] = useState<string | null>(null);
  // Turn-by-turn overlay (polyline + distance/duration) for the current
  // PREVIEWED stop's leg — see the fetch effect below for when it's populated.
  const [routeDirections, setRouteDirections] = useState<RouteDirections | null>(null);
  // Which stop id directions have already been fetched for — guards the
  // effect below so the endpoint is called once per distinct previewed stop,
  // never on a timer or on every GPS tick.
  const fetchedRouteForStopId = useRef<string | null>(null);
  // Mirror the latest previewed stop and currentPosition for the fetch effect
  // below to read without listing them as dependencies — both are new object
  // references on every render (previewStop is recomputed below,
  // currentPosition ticks every ~4s from the GPS watch), so depending on them
  // directly would re-run the fetch far more often than "the previewed stop
  // actually changed", racing a still-in-flight fetch against its own
  // cancellation.
  const previewStopRef = useRef<ManifestRouteStop | null>(null);
  const currentPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  // Riders grouped/ordered by manifest.routeStops (pickup stops first, then
  // dropoff stops, per the backend's visit order) with optimistic pickup/
  // dropoff overrides merged in. A rider whose pickupStop/dropoffStop is null
  // (legacy data) — or who otherwise doesn't match any current stop — simply
  // isn't grouped under a stop below; it never disappears from mergedRiders.
  const mergedRiders: ManifestRider[] = (manifest?.riders ?? []).map((rider) => {
    const optimistic = optimisticEvents[rider.id];
    return optimistic
      ? {
          ...rider,
          pickupConfirmedAt: rider.pickupConfirmedAt ?? optimistic.pickupConfirmedAt ?? null,
          droppedOffAt: rider.droppedOffAt ?? optimistic.droppedOffAt ?? null,
          pickupSource: rider.pickupSource ?? (optimistic.pickupConfirmedAt ? PickupSource.DRIVER_TAP : null),
        }
      : rider;
  });

  const stopGroups: { stop: ManifestRouteStop; riders: ManifestRider[] }[] = (manifest?.routeStops ?? []).map((stop) => {
    const stopRiders = mergedRiders.filter((rider) =>
      stop.type === 'PICKUP' ? rider.pickupStop?.id === stop.id : rider.dropoffStop?.id === stop.id,
    );
    return { stop, riders: stopRiders };
  });

  // First stop (in visit order) that still has unfinished business: a PICKUP
  // stop with a rider not yet picked up, or a DROPOFF stop with a rider not
  // yet dropped off. NO_SHOW riders are logged but never clear
  // pickupConfirmedAt, so a no-show at a stop keeps that stop "next" — matches
  // the driver having to actually resolve everyone there before moving on.
  const nextStop: ManifestRouteStop | null =
    stopGroups.find(({ stop, riders }) =>
      stop.type === 'PICKUP' ? riders.some((r) => !r.pickupConfirmedAt) : riders.some((r) => !r.droppedOffAt),
    )?.stop ?? null;

  const nextStopDistanceM =
    nextStop && currentPosition ? haversineDistanceMeters(currentPosition, { lat: nextStop.lat, lng: nextStop.lng }) : null;
  const canConfirmArrival = nextStopDistanceM !== null && nextStopDistanceM <= ARRIVAL_RADIUS_METERS;

  // Per-stop "is every rider at this stop fully resolved for its kind" —
  // shared by the map's numbered pins and the Stops tab's sequence dot/badge.
  const stopResolutions: StopResolution[] = stopGroups.map(({ stop, riders }) => ({
    stop,
    riders,
    resolved: stop.type === 'PICKUP' ? riders.every((r) => !!r.pickupConfirmedAt) : riders.every((r) => !!r.droppedOffAt),
  }));

  // The stop selectedStopId currently resolves to (or null before the first
  // sync below, or if it somehow names a stop no longer in this manifest).
  // stopGroups covers every routeStop unconditionally, so this lookup doesn't
  // miss stops that happen to have no riders on them.
  const previewStop: ManifestRouteStop | null =
    stopGroups.find((group) => group.stop.id === selectedStopId)?.stop ?? null;

  // Keeps selectedStopId auto-tracking nextStop by default. Whenever nextStop
  // changes: an unset selection snaps to it immediately; an existing
  // selection that has fallen BEHIND the new nextStop in visit order (i.e. it
  // names a stop that's now fully resolved/in the past) is treated as stale
  // and snapped forward too. A selection that is still at-or-ahead of
  // nextStop — the driver deliberately previewing a later stop — is left
  // alone; that's the override this exists to support.
  //
  // Done as a direct render-time comparison (React's documented "adjusting
  // state when a prop changes" pattern — comparing against a stored previous
  // value and calling setState immediately, guarded so it settles in one
  // extra render) rather than inside a useEffect: a synchronous setState in
  // an effect body trips this project's react-hooks/set-state-in-effect lint
  // rule. LiveTripMap's initialDriverCoordinate uses this same during-render
  // pattern for the same reason.
  if ((nextStop?.id ?? null) !== syncedNextStopId) {
    setSyncedNextStopId(nextStop?.id ?? null);
    if (nextStop) {
      const targetId = nextStop.id;
      const stopOrder = manifest?.routeStops ?? [];
      setSelectedStopId((prev) => {
        if (!prev) return targetId;
        const prevIndex = stopOrder.findIndex((s) => s.id === prev);
        const nextIndex = stopOrder.findIndex((s) => s.id === targetId);
        return prevIndex === -1 || prevIndex < nextIndex ? targetId : prev;
      });
    }
  }

  // `previewStop`/`currentPosition` are read at fetch time via these refs
  // rather than as effect dependencies — kept current via their own
  // no-dependency-array effect (runs after every render, before the fetch
  // effect below since it's declared first) rather than writing the refs
  // directly in the render body — required by this app's React Compiler
  // lint rule (react-hooks/refs).
  useEffect(() => {
    previewStopRef.current = previewStop;
    currentPositionRef.current = currentPosition;
  });

  // Route polyline + distance/duration for the map overlay, for the leg from
  // the driver's current position to whichever stop is currently PREVIEWED
  // (selectedStopId/previewStop — defaults to, and normally tracks, nextStop,
  // but the driver can preview a different stop from the Stops tab or map).
  // Depends only on `active`, selectedStopId (already a stable primitive —
  // no ref indirection needed for the dependency itself, only for reading the
  // resolved stop object at fetch time), and whether a GPS fix exists YET (a
  // boolean, not the position itself) — so this only re-runs when the
  // previewed stop genuinely changes, or once when the very first fix
  // arrives, never on every subsequent GPS tick. `fetchedRouteForStopId`
  // additionally guards against firing twice for the same stop id. A failed
  // call or a "no route" response just clears the overlay — this is a
  // nice-to-have, never something that blocks the Arrived/Pickup/Dropoff flow.
  useEffect(() => {
    const stop = previewStopRef.current;
    if (!active || !stop) return;
    if (fetchedRouteForStopId.current === stop.id) return;
    const position = currentPositionRef.current;
    if (!position) return; // no fix yet — retried once `!!currentPosition` flips true below

    fetchedRouteForStopId.current = stop.id;
    // Clear the previous stop's directions immediately so a stale
    // distance/duration/polyline never lingers on screen while the new leg
    // is fetched.
    setRouteDirections(null);

    let cancelled = false;
    geoApi
      .getRouteDirections({ lat: position.lat, lng: position.lng }, { lat: stop.lat, lng: stop.lng })
      .then((directions) => {
        if (!cancelled) setRouteDirections(directions);
      })
      .catch(() => {
        if (!cancelled) setRouteDirections(null);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selectedStopId, !!currentPosition]);

  return {
    mergedRiders,
    stopResolutions,
    nextStop,
    nextStopDistanceM,
    canConfirmArrival,
    selectedStopId,
    setSelectedStopId,
    previewStop,
    routeDirections,
  };
}
