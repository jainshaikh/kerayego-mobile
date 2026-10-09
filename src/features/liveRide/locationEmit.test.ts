import type { LocationObject } from 'expo-location';
import { describe, expect, it } from '@jest/globals';

import {
  isLocationEmitDue,
  LOCATION_EMIT_JITTER_TOLERANCE_MS,
  LOCATION_EMIT_MIN_INTERVAL_MS,
  toLocationUpdatePayload,
} from './locationEmit';

const T0 = 1_791_453_600_000;

function fix(
  coords: Partial<LocationObject['coords']> = {},
  extra: Partial<Pick<LocationObject, 'timestamp' | 'mocked'>> = {},
): LocationObject {
  return {
    coords: {
      latitude: 24.8607,
      longitude: 67.0011,
      altitude: null,
      accuracy: 8,
      altitudeAccuracy: null,
      heading: 90,
      speed: 10,
      ...coords,
    },
    timestamp: T0,
    ...extra,
  };
}

describe('isLocationEmitDue', () => {
  it('lets the first fix of a trip through', () => {
    expect(isLocationEmitDue(null, T0)).toBe(true);
  });

  it('holds fixes closer together than the minimum interval (iOS: one per ~10 m, ~3/s at highway speed)', () => {
    expect(isLocationEmitDue(T0, T0 + 300)).toBe(false);
    expect(isLocationEmitDue(T0, T0 + 1000)).toBe(false);
    expect(isLocationEmitDue(T0, T0 + 3000)).toBe(false);
  });

  it('allows a fix once ~4 s have passed, tolerating Android fix-time jitter around its own 4 s cadence', () => {
    expect(LOCATION_EMIT_MIN_INTERVAL_MS).toBe(4000);
    const floor = LOCATION_EMIT_MIN_INTERVAL_MS - LOCATION_EMIT_JITTER_TOLERANCE_MS;
    expect(isLocationEmitDue(T0, T0 + floor - 1)).toBe(false);
    expect(isLocationEmitDue(T0, T0 + floor)).toBe(true);
    expect(isLocationEmitDue(T0, T0 + 3990)).toBe(true);
    expect(isLocationEmitDue(T0, T0 + 4000)).toBe(true);
    expect(isLocationEmitDue(T0, T0 + 60_000)).toBe(true);
  });

  it('stays above the backend 2 s floor (MIN_LOCATION_INTERVAL_MS), so a throttled stream is never dropped as too_soon', () => {
    expect(LOCATION_EMIT_MIN_INTERVAL_MS - LOCATION_EMIT_JITTER_TOLERANCE_MS).toBeGreaterThan(2000);
  });

  it('does not freeze when the device clock jumps backwards', () => {
    expect(isLocationEmitDue(T0, T0 - 3_600_000)).toBe(true);
    expect(isLocationEmitDue(T0, T0 - 1)).toBe(true);
  });

  it('throttles a whole burst down to one emit per window', () => {
    // 3 fixes/s for 12 s, as iOS delivers them at ~100 km/h.
    let last: number | null = null;
    const emitted: number[] = [];
    for (let t = 0; t <= 12_000; t += 333) {
      if (isLocationEmitDue(last, T0 + t)) {
        last = T0 + t;
        emitted.push(t);
      }
    }
    expect(emitted).toEqual([0, 3996, 7992, 11988]);
  });
});

describe('toLocationUpdatePayload', () => {
  it('maps a normal fix, converting m/s to km/h and using the fix time as ts', () => {
    expect(toLocationUpdatePayload('trip-1', fix({}, { mocked: false }), T0 + 5000)).toEqual({
      tripId: 'trip-1',
      lat: 24.8607,
      lng: 67.0011,
      headingDeg: 90,
      speedKmh: 36,
      accuracyM: 8,
      isMockLocation: false,
      ts: T0,
    });
  });

  it("drops iOS's -1 'unknown' course and speed instead of sending -1 / -3.6", () => {
    const payload = toLocationUpdatePayload('trip-1', fix({ heading: -1, speed: -1 }));
    expect(payload?.headingDeg).toBeUndefined();
    expect(payload?.speedKmh).toBeUndefined();
    expect(payload?.lat).toBe(24.8607);
  });

  it('drops non-finite and null heading/speed/accuracy', () => {
    const payload = toLocationUpdatePayload(
      'trip-1',
      fix({ heading: Number.NaN, speed: Number.POSITIVE_INFINITY, accuracy: null }),
    );
    expect(payload?.headingDeg).toBeUndefined();
    expect(payload?.speedKmh).toBeUndefined();
    expect(payload?.accuracyM).toBeUndefined();

    const nulls = toLocationUpdatePayload('trip-1', fix({ heading: null, speed: null }));
    expect(nulls?.headingDeg).toBeUndefined();
    expect(nulls?.speedKmh).toBeUndefined();
  });

  it('drops a negative accuracy (an invalid reading) rather than failing the whole fix on the server', () => {
    expect(toLocationUpdatePayload('trip-1', fix({ accuracy: -1 }))?.accuracyM).toBeUndefined();
  });

  it('keeps a real zero heading and a stationary zero speed (Android reports 0 when unknown, which is valid)', () => {
    const payload = toLocationUpdatePayload('trip-1', fix({ heading: 0, speed: 0 }));
    expect(payload?.headingDeg).toBe(0);
    expect(payload?.speedKmh).toBe(0);
  });

  it('drops a heading outside the 0-360 range the gateway accepts', () => {
    expect(toLocationUpdatePayload('trip-1', fix({ heading: 360 }))?.headingDeg).toBe(360);
    expect(toLocationUpdatePayload('trip-1', fix({ heading: 361 }))?.headingDeg).toBeUndefined();
  });

  it('omits the mock flag when the platform does not report one (iOS)', () => {
    expect(toLocationUpdatePayload('trip-1', fix())?.isMockLocation).toBeUndefined();
    expect(toLocationUpdatePayload('trip-1', fix({}, { mocked: true }))?.isMockLocation).toBe(true);
  });

  it("rounds iOS's fractional millisecond timestamp", () => {
    expect(toLocationUpdatePayload('trip-1', fix({}, { timestamp: T0 + 0.6 }))?.ts).toBe(T0 + 1);
  });

  it('falls back to the current time only when the fix carries no usable timestamp', () => {
    expect(toLocationUpdatePayload('trip-1', fix({}, { timestamp: Number.NaN }), T0 + 42)?.ts).toBe(T0 + 42);
  });

  it('returns null for a fix without usable coordinates', () => {
    expect(toLocationUpdatePayload('trip-1', fix({ latitude: Number.NaN }))).toBeNull();
    expect(toLocationUpdatePayload('trip-1', fix({ longitude: Number.POSITIVE_INFINITY }))).toBeNull();
  });
});
