import type { TripStop } from '../../../types/api.types';

// One stop of the trip's whole route — from the rider's own request on a newer
// backend (with the server time the driver first reached it), or from the
// public trip fetch an older backend falls back to (no arrivedAt).
export type RouteStop = TripStop & { arrivedAt?: string | null };

export interface LocatedPoint {
  lat: number;
  lng: number;
}

/**
 * Whether a stop (or any point) can be measured against or pinned on a map —
 * a stop the driver typed as free text has null coordinates.
 */
export function hasCoordinates<T extends { lat: number | null; lng: number | null }>(
  point: T | null | undefined,
): point is T & LocatedPoint {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

const TYPE_ORDER: Record<TripStop['type'], number> = { PICKUP: 0, DROPOFF: 1 };

/**
 * Route order: every pickup stop, then every drop-off stop, each by
 * sortOrder — the order the backend itself returns them in. sortOrder is an
 * index within its own type (both start at 0), so sorting by it alone would
 * interleave pickups and drop-offs.
 */
export function orderRouteStops<T extends Pick<TripStop, 'type' | 'sortOrder'>>(stops: readonly T[]): T[] {
  return stops.slice().sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.sortOrder - b.sortOrder);
}

/** A stop's 1-based position in `orderedStops`, or null when it isn't on the route (or there's no id). */
export function routeSequence(orderedStops: readonly { id: string }[], stopId: string | null | undefined): number | null {
  if (!stopId) return null;
  const index = orderedStops.findIndex((stop) => stop.id === stopId);
  return index === -1 ? null : index + 1;
}
