import { useEffect, useRef, useState } from 'react';

import { geoApi, type RouteDirections } from '../../../api/geo.api';
import type { GeoPoint } from '../../liveRide/geo';
import { remainingMinutes, routeProgress } from './routeProgress';

// Refetch the leg's route once the driver strays this far from it…
const OFF_ROUTE_METERS = 75;
// …but no more often than this; a failed fetch is retried no sooner than
// FAILED_RETRY_MS. Every fetch is a paid Google Routes call (proxied by the
// backend), so the route is never refetched just because the driver moved.
const REROUTE_MIN_INTERVAL_MS = 30_000;
const FAILED_RETRY_MS = 60_000;

export interface LegRouteTarget {
  id: string;
  lat: number;
  lng: number;
}

export interface LegRoute {
  // From the driver's position onward (the part already driven trimmed off);
  // null until the first fetch lands, or when there's no route to show.
  polyline: GeoPoint[] | null;
  remainingKm: number | null;
  remainingMinutes: number | null;
}

interface FetchedRoute {
  stopId: string;
  directions: RouteDirections | null; // null: the fetch failed / no route
  fetchedAt: number;
}

/**
 * The driving route for the current leg — the driver's position to `target`,
 * the stop they're heading to (null while not navigating). Fetched once per
 * leg and again only when the driver goes off it; between fetches the line
 * is trimmed and the remaining distance/ETA recomputed on the phone from each
 * GPS fix (routeProgress.ts). A failed fetch just leaves the map without a
 * line — it never blocks the stop flow.
 */
export function useLegRoute(target: LegRouteTarget | null, position: GeoPoint | null): LegRoute {
  const [fetched, setFetched] = useState<FetchedRoute | null>(null);
  // The stop a fetch is in flight for — one at a time per leg.
  const inFlightStopId = useRef<string | null>(null);

  // Only this leg's route: one fetched for an earlier leg is never shown.
  const route = target && fetched?.stopId === target.id ? fetched : null;
  const directions = route?.directions ?? null;
  const progress = directions && position ? routeProgress(directions.polyline, position) : null;
  const offRoute = !!progress && progress.offRouteM > OFF_ROUTE_METERS;

  const targetId = target?.id ?? null;
  const targetLat = target?.lat ?? null;
  const targetLng = target?.lng ?? null;

  // Re-runs on every GPS fix but returns early unless this leg has no route
  // yet, the driver is off it, or a failed fetch is due a retry.
  useEffect(() => {
    if (!targetId || targetLat === null || targetLng === null || !position) return;
    if (route) {
      const wait = route.directions ? (offRoute ? REROUTE_MIN_INTERVAL_MS : Infinity) : FAILED_RETRY_MS;
      if (Date.now() - route.fetchedAt < wait) return;
    }
    if (inFlightStopId.current === targetId) return;

    inFlightStopId.current = targetId;
    geoApi
      .getRouteDirections(position, { lat: targetLat, lng: targetLng })
      .then((result) => setFetched({ stopId: targetId, directions: result, fetchedAt: Date.now() }))
      .catch(() => setFetched({ stopId: targetId, directions: null, fetchedAt: Date.now() }))
      .finally(() => {
        if (inFlightStopId.current === targetId) inFlightStopId.current = null;
      });
  }, [targetId, targetLat, targetLng, position, route, offRoute]);

  return {
    polyline: progress?.remainingPolyline ?? directions?.polyline ?? null,
    remainingKm: progress ? progress.remainingM / 1000 : (directions?.distanceKm ?? null),
    remainingMinutes:
      progress && directions ? remainingMinutes(progress.remainingM, directions) : (directions?.durationMinutes ?? null),
  };
}
