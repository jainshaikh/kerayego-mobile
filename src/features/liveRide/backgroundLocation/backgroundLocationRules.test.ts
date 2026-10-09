import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from '@jest/globals';
import type { LocationObject } from 'expo-location';

import type { DriverLocationFix } from '../../../api/trips.api';
import { REQUEST_TIMEOUT_MS } from '../../../constants/config';
import type { ActiveDriverTrip } from '../../../storage/active-driver-trip';
import {
  ACTIVE_RIDE_TRUST_DELAY_MS,
  BACKGROUND_LOCATION_DISTANCE_M,
  BACKGROUND_LOCATION_INTERVAL_MS,
  DRIVER_LOCATION_BATCH_MAX,
  LOCATION_POST_MIN_INTERVAL_MS,
  LOCATION_RATE_LIMIT_BACKOFF_MS,
  classifyLocationPostError,
  decideTaskRun,
  isForegroundAppState,
  isServerStopReason,
  locationPostWaitMs,
  mergePendingFixes,
  reconcileStopReason,
  toDriverLocationFix,
} from './backgroundLocationRules';

// Backend constants (kerayego-backend/src/modules/ride-realtime/
// ride-location.rules.ts), hand-copied — there is no shared package.
const BACKEND_DRIVER_LOCATION_BATCH_MAX = 20;
const BACKEND_DRIVER_LOCATION_REQUESTS_PER_MINUTE = 30;
const BACKEND_MIN_LOCATION_INTERVAL_MS = 2_000;

const T0 = 1_791_453_600_000;
const TRIP: ActiveDriverTrip = { tripId: 'trip-a', userId: 'user-ali', startedAt: T0 };

function location(overrides: Partial<LocationObject['coords']> = {}, extra: Partial<LocationObject> = {}) {
  return {
    coords: {
      latitude: 24.8607,
      longitude: 67.0011,
      altitude: null,
      accuracy: 8,
      altitudeAccuracy: null,
      heading: 90,
      speed: 10,
      ...overrides,
    },
    timestamp: T0,
    ...extra,
  } as LocationObject;
}

function fix(ts: number, lat = 24.86): DriverLocationFix {
  return { lat, lng: 67, ts };
}

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_RESPONSE, config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, statusCode: status, error: { code: 'ERR', message: 'x' }, timestamp: '', path: '/' },
  });
}

describe('backend parity and cadence', () => {
  it('batches no more fixes than the backend accepts per request', () => {
    expect(DRIVER_LOCATION_BATCH_MAX).toBe(BACKEND_DRIVER_LOCATION_BATCH_MAX);
  });

  it('posts well under the per-user rate limit, and not faster than the server keeps fixes', () => {
    expect(60_000 / LOCATION_POST_MIN_INTERVAL_MS).toBeLessThanOrEqual(BACKEND_DRIVER_LOCATION_REQUESTS_PER_MINUTE);
    expect(LOCATION_POST_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(BACKEND_MIN_LOCATION_INTERVAL_MS);
  });

  it('lets each Android delivery (10 s apart) go out immediately', () => {
    expect(BACKGROUND_LOCATION_INTERVAL_MS).toBe(10_000);
    expect(BACKGROUND_LOCATION_DISTANCE_M).toBe(25);
    expect(LOCATION_POST_MIN_INTERVAL_MS).toBeLessThan(BACKGROUND_LOCATION_INTERVAL_MS);
  });

  it('waits out the whole one-minute rate-limit window after a 429', () => {
    expect(LOCATION_RATE_LIMIT_BACKOFF_MS).toBe(60_000);
  });
});

describe('isForegroundAppState', () => {
  it.each(['active', 'inactive'] as const)("'%s' counts as the foreground", (state) => {
    expect(isForegroundAppState(state)).toBe(true);
  });

  it.each(['background', 'unknown', 'extension', null, undefined] as const)("'%s' does not", (state) => {
    expect(isForegroundAppState(state)).toBe(false);
  });
});

describe('toDriverLocationFix', () => {
  it('maps a full fix — speed to km/h, ts from the fix itself, no tripId', () => {
    expect(toDriverLocationFix(location({}, { mocked: false }), T0 + 5_000)).toEqual({
      lat: 24.8607,
      lng: 67.0011,
      headingDeg: 90,
      speedKmh: 36,
      accuracyM: 8,
      isMockLocation: false,
      ts: T0,
    });
  });

  it('leaves out iOS -1 heading/speed sentinels and invalid accuracy instead of sending negatives', () => {
    const result = toDriverLocationFix(location({ heading: -1, speed: -1, accuracy: -1 }));
    expect(result).toEqual({ lat: 24.8607, lng: 67.0011, ts: T0 });
    // Absent keys, not `undefined` values — every key sent must be one the
    // backend whitelists.
    expect(Object.keys(result as DriverLocationFix).sort()).toEqual(['lat', 'lng', 'ts']);
  });

  it('leaves out a heading above 360 and a missing mock flag', () => {
    const result = toDriverLocationFix(location({ heading: 400 }));
    expect(result).not.toHaveProperty('headingDeg');
    expect(result).not.toHaveProperty('isMockLocation');
    expect(result).not.toHaveProperty('tripId');
  });

  it('rounds a fractional fix time (iOS reports sub-millisecond timestamps)', () => {
    expect(toDriverLocationFix(location({}, { timestamp: T0 + 0.6 }))?.ts).toBe(T0 + 1);
  });

  it('falls back to now when the fix has no usable time', () => {
    expect(toDriverLocationFix(location({}, { timestamp: Number.NaN }), T0 + 42)?.ts).toBe(T0 + 42);
  });

  it('returns null for unusable coordinates', () => {
    expect(toDriverLocationFix(location({ latitude: Number.NaN }))).toBeNull();
  });
});

describe('mergePendingFixes', () => {
  it('keeps everything oldest first, newest last, whatever order they arrive in', () => {
    expect(mergePendingFixes([fix(T0 + 2000)], [fix(T0 + 3000), fix(T0 + 1000)]).map((f) => f.ts)).toEqual([
      T0 + 1000,
      T0 + 2000,
      T0 + 3000,
    ]);
  });

  it('keeps one fix per timestamp — the latest delivered copy', () => {
    const merged = mergePendingFixes([fix(T0, 1)], [fix(T0, 2)]);
    expect(merged).toEqual([fix(T0, 2)]);
  });

  it(`keeps only the newest ${DRIVER_LOCATION_BATCH_MAX}`, () => {
    const many = Array.from({ length: 25 }, (_, i) => fix(T0 + i * 1000));
    const merged = mergePendingFixes([], many);
    expect(merged).toHaveLength(DRIVER_LOCATION_BATCH_MAX);
    expect(merged[0].ts).toBe(T0 + 5_000);
    expect(merged[merged.length - 1].ts).toBe(T0 + 24_000);
  });

  it('drops the oldest pending fixes first when new ones overflow the batch', () => {
    const pending = Array.from({ length: 20 }, (_, i) => fix(T0 + i * 1000));
    const merged = mergePendingFixes(pending, [fix(T0 + 30_000)], 20);
    expect(merged[0].ts).toBe(T0 + 1000);
    expect(merged[merged.length - 1].ts).toBe(T0 + 30_000);
  });

  it('is empty for nothing', () => {
    expect(mergePendingFixes([], [])).toEqual([]);
  });
});

describe('decideTaskRun', () => {
  it('skips in the foreground — the watch and the socket send — even with nothing recorded', () => {
    expect(decideTaskRun({ appInForeground: true, trip: null, sessionUserId: null })).toEqual({ kind: 'skip' });
    expect(decideTaskRun({ appInForeground: true, trip: TRIP, sessionUserId: 'user-ali' })).toEqual({ kind: 'skip' });
  });

  it('stops a leftover registration with no trip recorded', () => {
    expect(decideTaskRun({ appInForeground: false, trip: null, sessionUserId: 'user-ali' })).toEqual({
      kind: 'stop',
      reason: 'no_active_trip',
    });
  });

  it('stops in a runtime with no signed-in session (an OS wake-up without the UI)', () => {
    expect(decideTaskRun({ appInForeground: false, trip: TRIP, sessionUserId: null })).toEqual({
      kind: 'stop',
      reason: 'no_session',
    });
  });

  it('stops — never sends — when another account is signed in', () => {
    expect(decideTaskRun({ appInForeground: false, trip: TRIP, sessionUserId: 'user-sara' })).toEqual({
      kind: 'stop',
      reason: 'other_user',
    });
  });

  it("sends in the background for the trip's own driver", () => {
    expect(decideTaskRun({ appInForeground: false, trip: TRIP, sessionUserId: 'user-ali' })).toEqual({
      kind: 'send',
      trip: TRIP,
    });
  });
});

describe('classifyLocationPostError', () => {
  it.each([
    [404, { kind: 'stop', reason: 'trip_not_found' }],
    [409, { kind: 'stop', reason: 'trip_not_in_progress' }],
    [401, { kind: 'stop', reason: 'session_rejected' }],
    [403, { kind: 'stop', reason: 'session_rejected' }],
    [429, { kind: 'rate_limited' }],
    [400, { kind: 'drop_batch' }],
    [422, { kind: 'drop_batch' }],
    [500, { kind: 'retry' }],
    [503, { kind: 'retry' }],
    [408, { kind: 'retry' }],
  ])('HTTP %i → %j', (status, outcome) => {
    expect(classifyLocationPostError(httpError(status))).toEqual(outcome);
  });

  it('retries after no answer at all (offline, timeout)', () => {
    expect(classifyLocationPostError(new AxiosError('Network Error', AxiosError.ERR_NETWORK))).toEqual({
      kind: 'retry',
    });
  });

  it('retries after a non-HTTP error (e.g. the refresh token unreadable)', () => {
    expect(classifyLocationPostError(new Error('keychain locked'))).toEqual({ kind: 'retry' });
  });
});

describe('isServerStopReason', () => {
  it.each(['ride_over', 'trip_not_found', 'trip_not_in_progress', 'session_rejected'] as const)(
    "'%s' is the server's verdict on the trip",
    (reason) => {
      expect(isServerStopReason(reason)).toBe(true);
    },
  );

  it.each(['trip_ended', 'signed_out', 'other_user', 'no_active_trip', 'no_session'] as const)(
    "'%s' is not",
    (reason) => {
      expect(isServerStopReason(reason)).toBe(false);
    },
  );
});

describe('locationPostWaitMs', () => {
  it('sends now when due (or never sent)', () => {
    expect(locationPostWaitMs(0, T0)).toBe(0);
    expect(locationPostWaitMs(T0, T0)).toBe(0);
    expect(locationPostWaitMs(T0 - 1, T0)).toBe(0);
  });

  it('waits out the short gap between two POSTs within the same wake-up', () => {
    expect(locationPostWaitMs(T0 + 3_000, T0)).toBe(3_000);
    expect(locationPostWaitMs(T0 + LOCATION_POST_MIN_INTERVAL_MS, T0)).toBe(LOCATION_POST_MIN_INTERVAL_MS);
  });

  it('leaves a rate-limit backoff to a later delivery', () => {
    expect(locationPostWaitMs(T0 + LOCATION_POST_MIN_INTERVAL_MS + 1, T0)).toBeNull();
    expect(locationPostWaitMs(T0 + LOCATION_RATE_LIMIT_BACKOFF_MS, T0)).toBeNull();
  });

  it('sends now when the device clock went backwards past any backoff', () => {
    expect(locationPostWaitMs(T0 + 60 * 60_000, T0)).toBe(0);
  });
});

describe('reconcileStopReason', () => {
  const trusted = T0 + ACTIVE_RIDE_TRUST_DELAY_MS;
  const driving = { role: 'driver', tripId: 'trip-a' } as const;

  it('trusts only an active-ride answer that was requested after sharing started', () => {
    expect(ACTIVE_RIDE_TRUST_DELAY_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });

  it('has nothing to decide without a recorded trip', () => {
    expect(reconcileStopReason({ trip: null, userId: null, activeRide: null, activeRideFetchedAt: trusted })).toBeNull();
  });

  it('waits while the session is still being restored', () => {
    expect(reconcileStopReason({ trip: TRIP, userId: undefined, activeRide: null, activeRideFetchedAt: trusted })).toBeNull();
  });

  it('stops once nobody is signed in', () => {
    expect(reconcileStopReason({ trip: TRIP, userId: null, activeRide: undefined, activeRideFetchedAt: 0 })).toBe(
      'signed_out',
    );
  });

  it('stops when another account is signed in, whatever the active ride says', () => {
    expect(
      reconcileStopReason({ trip: TRIP, userId: 'user-sara', activeRide: driving, activeRideFetchedAt: trusted }),
    ).toBe('other_user');
  });

  it('waits for the active-ride answer', () => {
    expect(reconcileStopReason({ trip: TRIP, userId: 'user-ali', activeRide: undefined, activeRideFetchedAt: 0 })).toBeNull();
  });

  it('ignores a "no ride" that may have been requested before the trip went live', () => {
    expect(
      reconcileStopReason({ trip: TRIP, userId: 'user-ali', activeRide: null, activeRideFetchedAt: trusted - 1 }),
    ).toBeNull();
  });

  it('stops when a trusted answer has no ride', () => {
    expect(reconcileStopReason({ trip: TRIP, userId: 'user-ali', activeRide: null, activeRideFetchedAt: trusted })).toBe(
      'ride_over',
    );
  });

  it('stops when the driver is now riding, or driving another trip', () => {
    expect(
      reconcileStopReason({
        trip: TRIP,
        userId: 'user-ali',
        activeRide: { role: 'rider', tripId: 'trip-a', tripInquiryId: 'inq-1' },
        activeRideFetchedAt: trusted,
      }),
    ).toBe('ride_over');
    expect(
      reconcileStopReason({
        trip: TRIP,
        userId: 'user-ali',
        activeRide: { role: 'driver', tripId: 'trip-b' },
        activeRideFetchedAt: trusted,
      }),
    ).toBe('ride_over');
  });

  it('keeps sharing while the driver is still on this trip', () => {
    expect(
      reconcileStopReason({ trip: TRIP, userId: 'user-ali', activeRide: driving, activeRideFetchedAt: trusted + 60_000 }),
    ).toBeNull();
  });
});
