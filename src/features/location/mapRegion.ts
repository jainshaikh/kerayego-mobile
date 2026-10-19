import type { LatLng, Region } from 'react-native-maps';

const MIN_DELTA = 0.0005;
const MAX_DELTA = 60;
// ~2m — close enough that two map centres count as the same picked spot.
const SAME_SPOT_EPSILON = 0.00002;

// Scales a region around its own centre: factor < 1 zooms in, > 1 zooms out
// (0.5 / 2 = one zoom level). Both deltas scale together so the region keeps
// the map view's aspect ratio, and the latitude span is clamped to a range
// the map can actually show.
export function zoomRegion(region: Region, factor: number): Region {
  const latitudeDelta = Math.min(MAX_DELTA, Math.max(MIN_DELTA, region.latitudeDelta * factor));
  const scale = latitudeDelta / region.latitudeDelta;
  return { ...region, latitudeDelta, longitudeDelta: region.longitudeDelta * scale };
}

export function isSameSpot(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.latitude - b.latitude) < SAME_SPOT_EPSILON && Math.abs(a.longitude - b.longitude) < SAME_SPOT_EPSILON;
}
