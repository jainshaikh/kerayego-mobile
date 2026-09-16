export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

// Great-circle distance, matching the backend's own geofence check
// (common/utils/geo.util.ts haversineDistanceKm, meters instead of km) —
// inlined rather than shared, since this is a separate app from
// kerayego-backend. Used by both the driver cockpit (arrival radius at a
// stop) and the rider live view (pickup/dropoff geofence).
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

// Short "value + unit" distance label, no directional suffix — callers that
// need "... away"/"... from you" supply their own trailing words. Same
// magnitude logic as utils/format.ts's formatDistance, kept separate since
// that one always appends " away" and is shared with unrelated rental
// screens this feature shouldn't couple to.
export function formatDistanceShort(distanceKm: number): string {
  return distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`;
}
