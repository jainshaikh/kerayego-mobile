import { haversineDistanceMeters, type GeoPoint } from '../../liveRide/geo';

export interface RouteProgress {
  // Straight-line distance from the driver to the nearest point on the route.
  offRouteM: number;
  // Route distance still to drive, from that nearest point to the end.
  remainingM: number;
  // The route from the driver onward — the part already driven trimmed off.
  remainingPolyline: GeoPoint[];
}

const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;

/**
 * Where the driver is along a leg's route line: snapped to the closest point
 * on any of its segments. Segment maths runs on a flat (equirectangular)
 * projection around the driver — well under a metre off over the few hundred
 * metres between route vertices — and distances along the line use haversine.
 * Null for a line too short to have a segment.
 */
export function routeProgress(polyline: readonly GeoPoint[], position: GeoPoint): RouteProgress | null {
  if (polyline.length < 2) return null;

  const metersPerLng = METERS_PER_DEGREE * Math.cos((position.lat * Math.PI) / 180);
  const toXY = (p: GeoPoint) => ({
    x: (p.lng - position.lng) * metersPerLng,
    y: (p.lat - position.lat) * METERS_PER_DEGREE,
  });

  let best = { distance: Infinity, segment: 0, t: 0 };
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = toXY(polyline[i]);
    const b = toXY(polyline[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    // The driver is the origin, so the closest point is a + t·(b − a) for the
    // t that projects (0,0) onto the segment, clamped to its ends.
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / lengthSq));
    const distance = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (distance < best.distance) best = { distance, segment: i, t };
  }

  const from = polyline[best.segment];
  const to = polyline[best.segment + 1];
  const nearest = { lat: from.lat + best.t * (to.lat - from.lat), lng: from.lng + best.t * (to.lng - from.lng) };
  const ahead = polyline.slice(best.segment + 1);

  let remainingM = haversineDistanceMeters(nearest, ahead[0]);
  for (let i = 0; i < ahead.length - 1; i++) remainingM += haversineDistanceMeters(ahead[i], ahead[i + 1]);

  return { offRouteM: best.distance, remainingM, remainingPolyline: [position, nearest, ...ahead] };
}

/** The route's own drive time scaled by the share of its distance still left. */
export function remainingMinutes(remainingM: number, route: { distanceKm: number; durationMinutes: number }): number {
  if (!(route.distanceKm > 0)) return 0;
  return route.durationMinutes * Math.min(1, remainingM / (route.distanceKm * 1000));
}
