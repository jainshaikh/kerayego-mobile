import type { AppStateStatus } from 'react-native';
import type { LocationObject } from 'expo-location';

import { normalizeApiError } from '../../../api/errors';
import type { DriverLocationFix, MyActiveRide } from '../../../api/trips.api';
import { REQUEST_TIMEOUT_MS } from '../../../constants/config';
import type { ActiveDriverTrip } from '../../../storage/active-driver-trip';
import { toLocationUpdatePayload } from '../locationEmit';

// Pure rules for the driver's background location sharing
// (driverLocationSharing.ts) — no native module, storage or network in here,
// so every decision the task makes can be unit-tested directly.

// Background cadence (owner decision): about one fix every 10 s / 25 m. The
// foreground watch (useDriverLocationWatch) keeps its own 4 s / 10 m.
// timeInterval is Android-only — iOS delivers on every 25 m of movement, and
// the POST throttle below spaces those out instead.
export const BACKGROUND_LOCATION_INTERVAL_MS = 10_000;
export const BACKGROUND_LOCATION_DISTANCE_M = 25;

// Mirrors the backend's DRIVER_LOCATION_BATCH_MAX (ride-location.rules.ts):
// at most this many fixes per POST /my/trips/:id/location.
export const DRIVER_LOCATION_BATCH_MAX = 20;

// Minimum gap between two POSTs. Below Android's 10 s delivery interval, so
// each Android delivery goes out as soon as it arrives; iOS fixes that arrive
// in between are batched into the next POST. Keeps the task far under the
// backend's 30 requests/minute per user.
export const LOCATION_POST_MIN_INTERVAL_MS = 8_000;

// After a 429: the backend's rate-limit window is one minute.
export const LOCATION_RATE_LIMIT_BACKOFF_MS = 60_000;

// GET /my/active-ride is only trusted to say "this trip's ride is over" when
// its answer arrived this long after sharing started: a request takes at most
// REQUEST_TIMEOUT_MS, so such an answer was requested after sharing started —
// never by a poll that left before the trip went IN_PROGRESS and came back
// with that older "no ride".
export const ACTIVE_RIDE_TRUST_DELAY_MS = REQUEST_TIMEOUT_MS + 5_000;

/**
 * Whether the app counts as in the foreground: 'active', or iOS's brief
 * 'inactive' (app switcher, notification centre, an incoming-call banner) —
 * the same split as hooks/useAppInForeground. The foreground GPS watch and the
 * socket own location sharing then; the background task posts over REST only
 * otherwise, so exactly one of them sends at any moment.
 */
export function isForegroundAppState(state: AppStateStatus | null | undefined): boolean {
  return state === 'active' || state === 'inactive';
}

/** One expo-location fix as a REST location item — the socket payload's sanitizing, minus `tripId` and absent keys. */
export function toDriverLocationFix(
  location: Pick<LocationObject, 'coords' | 'timestamp' | 'mocked'>,
  nowMs: number = Date.now(),
): DriverLocationFix | null {
  const payload = toLocationUpdatePayload('', location, nowMs);
  if (!payload) return null;
  const fix: DriverLocationFix = { lat: payload.lat, lng: payload.lng, ts: payload.ts };
  if (payload.headingDeg !== undefined) fix.headingDeg = payload.headingDeg;
  if (payload.speedKmh !== undefined) fix.speedKmh = payload.speedKmh;
  if (payload.accuracyM !== undefined) fix.accuracyM = payload.accuracyM;
  if (payload.isMockLocation !== undefined) fix.isMockLocation = payload.isMockLocation;
  return fix;
}

/**
 * Adds newly delivered fixes to the ones not sent yet: oldest first, newest
 * last, one per timestamp (the latest copy wins), and only the newest `max` —
 * the backend broadcasts just the newest accepted fix anyway, so older ones
 * are the first to go.
 */
export function mergePendingFixes(
  pending: readonly DriverLocationFix[],
  incoming: readonly DriverLocationFix[],
  max: number = DRIVER_LOCATION_BATCH_MAX,
): DriverLocationFix[] {
  const byTs = new Map<number, DriverLocationFix>();
  for (const fix of [...pending, ...incoming]) byTs.set(fix.ts, fix);
  const merged = [...byTs.values()].sort((a, b) => a.ts - b.ts);
  return merged.slice(Math.max(0, merged.length - max));
}

// Why sharing stopped. The server's verdicts on a trip (SERVER_STOP_REASONS)
// also keep that trip from being restarted for the rest of this app run.
export type DriverLocationStopReason =
  // The driver's trip screen saw the trip end (End ride, synced or queued).
  | 'trip_ended'
  // Logout, or the session expired.
  | 'signed_out'
  // A different account is signed in than the one that started sharing.
  | 'other_user'
  // The task fired with no trip recorded — a leftover registration.
  | 'no_active_trip'
  // The task fired in the background in a JS runtime with no signed-in
  // session — the OS woke the app without its UI (e.g. after the process was
  // killed). Sharing is for while the app is running only (owner decision).
  | 'no_session'
  // GET /my/active-ride no longer lists this trip as the driver's live ride.
  | 'ride_over'
  // POST /my/trips/:id/location: 404 — no such trip, the caller isn't its
  // driver, or an older backend without the route.
  | 'trip_not_found'
  // POST /my/trips/:id/location: 409 TRIP_NOT_IN_PROGRESS.
  | 'trip_not_in_progress'
  // POST /my/trips/:id/location: 401/403 even after the token refresh.
  | 'session_rejected';

const SERVER_STOP_REASONS: ReadonlySet<DriverLocationStopReason> = new Set<DriverLocationStopReason>([
  'ride_over',
  'trip_not_found',
  'trip_not_in_progress',
  'session_rejected',
]);

/** Whether a stop was the server's verdict on the trip — sharing isn't restarted for it again this run. */
export function isServerStopReason(reason: DriverLocationStopReason): boolean {
  return SERVER_STOP_REASONS.has(reason);
}

export type TaskRunDecision =
  // In the foreground: the GPS watch + socket own sharing; nothing to send.
  | { kind: 'skip' }
  | { kind: 'stop'; reason: DriverLocationStopReason }
  | { kind: 'send'; trip: ActiveDriverTrip };

/**
 * What the background task does with a delivery of fixes. Stops it when
 * there's no trip to report for, when another account is signed in, or —
 * in the background only — when this JS runtime has no signed-in session at
 * all (an OS wake-up without the app's UI: sharing is only for while the app
 * itself is running).
 */
export function decideTaskRun(input: {
  appInForeground: boolean;
  trip: ActiveDriverTrip | null;
  sessionUserId: string | null;
}): TaskRunDecision {
  const { appInForeground, trip, sessionUserId } = input;
  if (appInForeground) return { kind: 'skip' };
  if (!trip) return { kind: 'stop', reason: 'no_active_trip' };
  if (sessionUserId === null) return { kind: 'stop', reason: 'no_session' };
  if (sessionUserId !== trip.userId) return { kind: 'stop', reason: 'other_user' };
  return { kind: 'send', trip };
}

export type LocationPostOutcome =
  | { kind: 'stop'; reason: DriverLocationStopReason }
  // 429: wait out the backend's one-minute window.
  | { kind: 'rate_limited' }
  // 400: the server refused this batch's contents — sending it again can't
  // help, but the next fixes may be fine.
  | { kind: 'drop_batch' }
  // Offline, a timeout, a 5xx: keep the fixes for the next attempt.
  | { kind: 'retry' };

/**
 * What a failed POST /my/trips/:id/location means for the task. A 401 has
 * already been through the shared token refresh (api/client.ts) — reaching
 * here, there's no session left to send under.
 */
export function classifyLocationPostError(error: unknown): LocationPostOutcome {
  switch (normalizeApiError(error).kind) {
    case 'not_found':
      return { kind: 'stop', reason: 'trip_not_found' };
    case 'conflict':
      return { kind: 'stop', reason: 'trip_not_in_progress' };
    case 'unauthorized':
    case 'forbidden':
      return { kind: 'stop', reason: 'session_rejected' };
    case 'rate_limited':
      return { kind: 'rate_limited' };
    case 'validation':
      return { kind: 'drop_batch' };
    default:
      return { kind: 'retry' };
  }
}

/**
 * How long to wait before the next POST, given when it's next allowed
 * (`nextPostAt`, epoch ms): 0 to send now; a short wait (up to
 * LOCATION_POST_MIN_INTERVAL_MS) the task sleeps out within the same
 * wake-up; or `null` when it's a rate-limit backoff — too long to keep the
 * OS's background execution waiting, so a later delivery tries again. A gap
 * longer than any backoff means the device clock went backwards: send now.
 */
export function locationPostWaitMs(nextPostAt: number, nowMs: number): number | null {
  const wait = nextPostAt - nowMs;
  if (wait <= 0) return 0;
  if (wait <= LOCATION_POST_MIN_INTERVAL_MS) return wait;
  if (wait <= LOCATION_RATE_LIMIT_BACKOFF_MS) return null;
  return 0;
}

/**
 * Whether app-wide state says background sharing must stop: the recorded
 * trip belongs to someone other than the signed-in user (nobody, after a
 * logout), or a GET /my/active-ride answer requested after sharing started
 * no longer has the driver on that trip. `userId` is undefined while the
 * session is still being restored — no decision then. `activeRide` is
 * undefined until the query has answered; `activeRideFetchedAt` is when it
 * did (react-query's dataUpdatedAt, device clock).
 */
export function reconcileStopReason(input: {
  trip: ActiveDriverTrip | null;
  userId: string | null | undefined;
  activeRide: MyActiveRide | undefined;
  activeRideFetchedAt: number;
}): DriverLocationStopReason | null {
  const { trip, userId, activeRide, activeRideFetchedAt } = input;
  if (!trip || userId === undefined) return null;
  if (userId === null) return 'signed_out';
  if (userId !== trip.userId) return 'other_user';
  if (activeRide === undefined) return null;
  if (activeRideFetchedAt < trip.startedAt + ACTIVE_RIDE_TRUST_DELAY_MS) return null;
  if (activeRide === null || activeRide.role !== 'driver' || activeRide.tripId !== trip.tripId) return 'ride_over';
  return null;
}
