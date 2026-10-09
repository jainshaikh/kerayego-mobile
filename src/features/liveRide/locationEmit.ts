import type { LocationObject } from 'expo-location';

import type { LocationUpdatePayload } from './socket';

// Pure helpers for the driver's `location.update` emit (socket.ts emitLocation
// and the cockpit's GPS watch) — no socket or native module in here, so they
// can be unit-tested directly.

// Minimum gap between two emitted fixes, measured on the fixes' own
// timestamps. iOS ignores expo-location's `timeInterval` (Android-only) and
// fires on every 10 m of movement — about 3 fixes/s at highway speed — so
// without this the driver would emit (and the server would authorize and
// broadcast) several times a second. Matches web's EMIT_THROTTLE_MS. The
// geofence/UI still sees every fix; only the emit is throttled.
export const LOCATION_EMIT_MIN_INTERVAL_MS = 4000;

// Android's fused provider already spaces fixes ~4 s apart (timeInterval and
// min update interval 4000), but consecutive fix times can land a few ms
// either side of that — without this allowance a strict 4000 ms floor would
// drop every other Android fix and halve its cadence to ~8 s. Still far
// above the backend's own 2 s floor (MIN_LOCATION_INTERVAL_MS).
export const LOCATION_EMIT_JITTER_TOLERANCE_MS = 250;

/**
 * Whether a fix taken at `fixTs` may be emitted, given the timestamp of the
 * last fix actually emitted for the same trip (`null` when none yet).
 */
export function isLocationEmitDue(lastEmittedTs: number | null, fixTs: number): boolean {
  if (lastEmittedTs === null) return true;
  const elapsed = fixTs - lastEmittedTs;
  // A device clock that jumped backwards (manual change, NTP correction)
  // must not freeze emits until real time catches up with the old value.
  if (elapsed < 0) return true;
  return elapsed >= LOCATION_EMIT_MIN_INTERVAL_MS - LOCATION_EMIT_JITTER_TOLERANCE_MS;
}

// A non-negative finite number, or undefined. iOS reports an unknown course
// and speed as -1 (CLLocation, passed through unchanged by expo-location),
// and a negative accuracy for an invalid reading; the gateway's @Min(0)
// rejects the WHOLE fix on the old backend for any of them.
function nonNegative(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Builds the `location.update` payload for one expo-location fix, or `null`
 * when the fix has no usable coordinates. Unknown/sentinel heading, speed and
 * accuracy are left out instead of sent as negatives, and `ts` is the fix's
 * own capture time (not the JS-callback time) — the backend orders fixes by
 * it, so a late-delivered fix can never overtake a newer one.
 */
export function toLocationUpdatePayload(
  tripId: string,
  location: Pick<LocationObject, 'coords' | 'timestamp' | 'mocked'>,
  nowMs: number = Date.now(),
): LocationUpdatePayload | null {
  const { latitude, longitude, heading, speed, accuracy } = location.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const headingDeg = nonNegative(heading);
  const speedMs = nonNegative(speed);
  const accuracyM = nonNegative(accuracy);

  return {
    tripId,
    lat: latitude,
    lng: longitude,
    // The gateway accepts 0-360 only.
    headingDeg: headingDeg !== undefined && headingDeg <= 360 ? headingDeg : undefined,
    // expo-location reports speed in metres/second; the gateway payload is km/h.
    speedKmh: speedMs !== undefined ? speedMs * 3.6 : undefined,
    accuracyM,
    isMockLocation: location.mocked ?? undefined,
    ts: Number.isFinite(location.timestamp) && location.timestamp >= 0 ? Math.round(location.timestamp) : nowMs,
  };
}
