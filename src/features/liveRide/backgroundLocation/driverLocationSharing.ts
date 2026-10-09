import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { requireOptionalNativeModule } from 'expo';
// Type-only: erased at build time, so this module never loads
// expo-task-manager's native module (registerDriverLocationTask.ts does,
// guarded, for builds that include it).
import type { TaskManagerTaskBody } from 'expo-task-manager';

import { tripsApi, type DriverLocationFix, type MyActiveRide } from '../../../api/trips.api';
import { REQUEST_TIMEOUT_MS } from '../../../constants/config';
import {
  clearActiveDriverTrip,
  readActiveDriverTrip,
  writeActiveDriverTrip,
  type ActiveDriverTrip,
} from '../../../storage/active-driver-trip';
import {
  BACKGROUND_LOCATION_DISTANCE_M,
  BACKGROUND_LOCATION_INTERVAL_MS,
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
  type DriverLocationStopReason,
  type LocationPostOutcome,
} from './backgroundLocationRules';

// ─── Driver location while the app is in the background ────────────────────
// While a trip the driver is driving is IN_PROGRESS, an expo-location
// background task (an Android foreground service with its "Trip in progress"
// notification; iOS's background location mode, blue indicator) keeps
// receiving GPS fixes after the driver leaves the app — e.g. into Google
// Maps from the cockpit's own Navigate button. Owner decisions: When-In-Use
// permission only, and only while the app's process is alive (the Android
// service dies with the app, killServiceOnDestroy).
//
// One GPS source per moment: in the foreground the cockpit's own watch
// (useDriverLocationWatch, 4 s / 10 m) feeds the geofence and emits over the
// socket exactly as before, and this task ignores its fixes; in the
// background the task posts them over REST (POST /my/trips/:id/location) in
// batches. The task's executor (handleDriverLocationTask) is registered at
// module scope from the app's entry (index.js → registerDriverLocationTask.ts),
// so it exists in every JS start — including one the OS makes without the
// UI. Which trip, and whose: storage/active-driver-trip.ts.
//
// Starts from the cockpit (useDriverBackgroundLocation) once the server says
// the trip is IN_PROGRESS; stops on trip end, logout/expiry (AuthProvider),
// the active ride going away (useDriverLocationReconcile), or the location
// endpoint answering 404/409.

export const DRIVER_LOCATION_TASK = 'kerayego.driver-location';

// A flush that has been running longer than this (one wait plus a request
// that refreshed its token and retried) is presumed stuck — e.g. a timer the
// OS never fired — and the next delivery starts a fresh one.
const FLUSH_STALE_MS = LOCATION_POST_MIN_INTERVAL_MS + 2 * REQUEST_TIMEOUT_MS;

export type BackgroundLocationStatus =
  | { state: 'idle' }
  | { state: 'starting' | 'running'; tripId: string }
  // 'unavailable': this build has no background location support (Expo Go,
  // web, or a binary built before expo-task-manager was added).
  | { state: 'failed'; tripId: string; reason: 'unavailable' | 'start_failed' }
  | { state: 'stopped'; tripId: string | null; reason: DriverLocationStopReason };

interface DriverLocationTaskData {
  locations?: Location.LocationObject[];
}

// ─── Module state (one JS runtime) ─────────────────────────────────────────

let status: BackgroundLocationStatus = { state: 'idle' };
const statusListeners = new Set<() => void>();

// The signed-in user in THIS JS runtime, set by AuthProvider. Null in a
// runtime the OS started without the UI — which never signs in.
let sessionUserId: string | null = null;

// Trips the server said to stop for (isServerStopReason) — never restarted in
// this app run, so e.g. an older backend's 404 doesn't start the foreground
// service again every time the driver returns to the app.
const serverStoppedTrips = new Set<string>();

// Bumped by every start and stop: an async start, stop or reconcile that
// began before another one changed things gives up instead of undoing it.
let lifecycle = 0;
let startInFlight: { tripId: string; promise: Promise<void> } | null = null;

// Fixes delivered in the background and not posted yet, oldest first.
let pending: DriverLocationFix[] = [];
// Earliest time (epoch ms) the next POST may go out.
let nextPostAt = 0;
// The one flush allowed at a time; stop() bumps flushRun so a running one
// exits at its next check.
let flushRun = 0;
let flushing: { run: number; startedAt: number } | null = null;

function setStatus(next: BackgroundLocationStatus): void {
  status = next;
  statusListeners.forEach((listener) => listener());
}

export function getBackgroundLocationStatus(): BackgroundLocationStatus {
  return status;
}

export function subscribeBackgroundLocationStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** AuthProvider: who is signed in — on login and session restore, and null when the session ends. */
export function setDriverLocationSessionUser(userId: string | null): void {
  if (userId === sessionUserId) return;
  sessionUserId = userId;
  // The previous account's refused trips say nothing about the next one's.
  serverStoppedTrips.clear();
}

/** Whether the server ended sharing for this trip this run (404/409, or no longer the active ride). */
export function wasStoppedByServer(tripId: string): boolean {
  return serverStoppedTrips.has(tripId);
}

/**
 * Whether this build can share location in the background at all: not on
 * web, and only in a binary that includes expo-task-manager's native module
 * (dev clients built before it was added don't).
 */
export function isBackgroundLocationSupported(): boolean {
  return Platform.OS !== 'web' && requireOptionalNativeModule('ExpoTaskManager') !== null;
}

function driverLocationTaskOptions(): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy.High,
    // Android only; iOS delivers by distance and the POST throttle spaces it.
    timeInterval: BACKGROUND_LOCATION_INTERVAL_MS,
    distanceInterval: BACKGROUND_LOCATION_DISTANCE_M,
    // iOS: tuned for driving — and never paused. iOS's own default (true,
    // whatever the typings say) can pause updates while the car waits at a
    // pickup, and they don't resume until the app is opened again.
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    // iOS: the blue status-bar indicator — what lets a When-In-Use grant
    // keep receiving updates in the background.
    showsBackgroundLocationIndicator: true,
    // Android: the foreground service and its ongoing notification, without
    // which there are no background fixes at all on When-In-Use. It ends when
    // the app is swiped away (owner decision: only while the app is alive).
    foregroundService: {
      notificationTitle: 'Trip in progress',
      notificationBody: 'KerayeGo is sharing your location with your riders',
      killServiceOnDestroy: true,
    },
  };
}

async function hasStartedUpdates(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  } catch {
    return false;
  }
}

async function stopUpdatesQuietly(): Promise<void> {
  if (!isBackgroundLocationSupported()) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    }
  } catch (error) {
    console.warn('[driverLocation] failed to stop background location updates:', error);
  }
}

function resetSender(): void {
  pending = [];
  nextPostAt = 0;
  flushRun += 1;
  flushing = null;
}

// ─── Start / stop ───────────────────────────────────────────────────────────

/**
 * Starts sharing this trip's driver location in the background — or confirms
 * it's still running (the cockpit calls this on every mount and every return
 * to the foreground). Call only from the foreground, once the server has
 * confirmed the trip IN_PROGRESS: Android refuses to start a location
 * foreground service from the background. Never throws; a failure shows in
 * the status ('failed').
 */
export function ensureDriverLocationSharing(tripId: string, userId: string): Promise<void> {
  if (startInFlight?.tripId === tripId) return startInFlight.promise;
  const promise = startSharing(tripId, userId).finally(() => {
    if (startInFlight?.promise === promise) startInFlight = null;
  });
  startInFlight = { tripId, promise };
  return promise;
}

function mayStart(tripId: string, userId: string): boolean {
  return !serverStoppedTrips.has(tripId) && sessionUserId === userId;
}

async function startSharing(tripId: string, userId: string): Promise<void> {
  if (!mayStart(tripId, userId)) return;
  if (!isBackgroundLocationSupported()) {
    setStatus({ state: 'failed', tripId, reason: 'unavailable' });
    return;
  }
  if (status.state === 'running' && status.tripId === tripId && (await hasStartedUpdates())) return;
  // Again after the await: a logout or a server verdict may have landed.
  if (!mayStart(tripId, userId)) return;

  const run = ++lifecycle;
  setStatus({ state: 'starting', tripId });
  try {
    const stored = await readActiveDriverTrip();
    if (stored && stored.tripId !== tripId) resetSender();
    // Keep the original start time when it's the same trip being re-started
    // (a remount, an app relaunch) — the active-ride check counts from it.
    const startedAt = stored?.tripId === tripId && stored.userId === userId ? stored.startedAt : Date.now();
    // The record first, the registration second: a fix delivered the moment
    // the task is registered must already know its trip.
    await writeActiveDriverTrip({ tripId, userId, startedAt });
    if (run !== lifecycle) {
      await clearActiveDriverTrip();
      return;
    }
    await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, driverLocationTaskOptions());
    if (run !== lifecycle) {
      // Stopped while registering (logout, trip end): undo.
      await Promise.all([stopUpdatesQuietly(), clearActiveDriverTrip()]);
      return;
    }
    setStatus({ state: 'running', tripId });
  } catch (error) {
    console.warn('[driverLocation] background location updates failed to start:', error);
    if (run !== lifecycle) return;
    // An earlier registration for this trip (one the OS restored at launch,
    // say) may still be alive — keep the record it reports by. With none,
    // forget the trip.
    if (!(await hasStartedUpdates())) await clearActiveDriverTrip().catch(() => undefined);
    if (run !== lifecycle) return;
    setStatus({ state: 'failed', tripId, reason: 'start_failed' });
  }
}

/**
 * Stops background sharing (if running) and forgets the trip. Idempotent;
 * never throws. A server verdict (isServerStopReason) also keeps `tripId`
 * from being restarted for the rest of this app run.
 */
export async function stopDriverLocationSharing(
  reason: DriverLocationStopReason,
  tripId: string | null = null,
): Promise<void> {
  lifecycle += 1;
  resetSender();
  const stoppedTripId = tripId ?? ('tripId' in status ? status.tripId : null);
  if (stoppedTripId && isServerStopReason(reason)) serverStoppedTrips.add(stoppedTripId);
  setStatus({ state: 'stopped', tripId: stoppedTripId, reason });
  await Promise.all([
    clearActiveDriverTrip().catch((error) => {
      console.warn('[driverLocation] failed to clear the active driver trip:', error);
    }),
    stopUpdatesQuietly(),
  ]);
}

/** Stops sharing only if it's this trip's — what a trip screen does once its trip is over. */
export async function stopDriverLocationSharingForTrip(
  tripId: string,
  reason: DriverLocationStopReason,
): Promise<void> {
  const ownedHere = (status.state === 'starting' || status.state === 'running') && status.tripId === tripId;
  let stored: ActiveDriverTrip | null = null;
  if (!ownedHere) {
    try {
      stored = await readActiveDriverTrip();
    } catch {
      return;
    }
  }
  if (ownedHere || stored?.tripId === tripId) await stopDriverLocationSharing(reason, tripId);
}

/**
 * App-wide check (useDriverLocationReconcile): stops sharing that no longer
 * belongs — another account (or nobody) signed in, or GET /my/active-ride no
 * longer has the driver on that trip — and a native registration left behind
 * with no trip recorded.
 */
export async function reconcileDriverLocationSharing(input: {
  userId: string | null | undefined;
  activeRide: MyActiveRide | undefined;
  activeRideFetchedAt: number;
}): Promise<void> {
  if (!isBackgroundLocationSupported()) return;
  const run = lifecycle;
  let trip: ActiveDriverTrip | null;
  try {
    trip = await readActiveDriverTrip();
  } catch {
    return;
  }
  if (run !== lifecycle) return;

  const reason = reconcileStopReason({ trip, ...input });
  if (reason) {
    await stopDriverLocationSharing(reason, trip?.tripId ?? null);
    return;
  }
  // A registration the OS restored with no trip recorded (an earlier run died
  // between clearing the record and unregistering). Only once the session is
  // known — and only if nothing started or stopped meanwhile, since a start
  // writes the record before registering.
  if (!trip && input.userId !== undefined && (await hasStartedUpdates()) && run === lifecycle) {
    await stopDriverLocationSharing('no_active_trip');
  }
}

// ─── The task ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The background location task's executor — expo-location hands it every
 * batch of fixes the OS delivers (registered in defineDriverLocationTask.ts).
 * Resolves once its POST (if any) is done: the OS keeps the app's background
 * execution (Android's job, iOS's background task) open until then.
 */
export async function handleDriverLocationTask({
  data,
  error,
}: Pick<TaskManagerTaskBody<DriverLocationTaskData | undefined>, 'data' | 'error'>): Promise<void> {
  if (error) {
    // E.g. iOS's "location unknown" while GPS warms up — transient; the next
    // delivery may well have a fix.
    console.warn('[driverLocation] background location error:', error.message);
    return;
  }
  // The foreground watch + socket have these fixes covered — and fixes
  // still waiting from the background are stale now.
  if (isForegroundAppState(AppState.currentState)) {
    pending = [];
    return;
  }

  let trip: ActiveDriverTrip | null;
  try {
    trip = await readActiveDriverTrip();
  } catch (readError) {
    console.warn('[driverLocation] could not read the active driver trip:', readError);
    return;
  }
  const decision = decideTaskRun({
    appInForeground: isForegroundAppState(AppState.currentState),
    trip,
    sessionUserId,
  });
  if (decision.kind === 'skip') {
    pending = [];
    return;
  }
  if (decision.kind === 'stop') {
    await stopDriverLocationSharing(decision.reason, trip?.tripId ?? null);
    return;
  }

  const fixes = (data?.locations ?? [])
    .map((location) => toDriverLocationFix(location))
    .filter((fix): fix is DriverLocationFix => fix !== null);
  if (fixes.length === 0) return;
  await deliverFixes(decision.trip.tripId, fixes);
}

// Adds the fixes to the batch and makes sure one flush is sending it. Only
// the delivery that starts a flush waits for it; later ones just add to it.
function deliverFixes(tripId: string, fixes: DriverLocationFix[]): Promise<void> {
  pending = mergePendingFixes(pending, fixes);
  const now = Date.now();
  if (flushing && now - flushing.startedAt < FLUSH_STALE_MS) return Promise.resolve();
  flushRun += 1;
  const run = flushRun;
  flushing = { run, startedAt: now };
  return flushPending(tripId, run).finally(() => {
    if (flushing?.run === run) flushing = null;
  });
}

async function flushPending(tripId: string, run: number): Promise<void> {
  while (pending.length > 0) {
    const wait = locationPostWaitMs(nextPostAt, Date.now());
    // Rate-limited: a later delivery tries again once the window has passed.
    if (wait === null) return;
    if (wait > 0) await sleep(wait);
    if (run !== flushRun) return;
    if (isForegroundAppState(AppState.currentState)) {
      pending = [];
      return;
    }

    const batch = pending;
    const newestTs = batch[batch.length - 1].ts;
    let outcome: LocationPostOutcome | null = null;
    try {
      await tripsApi.recordDriverLocations(tripId, batch);
    } catch (postError) {
      outcome = classifyLocationPostError(postError);
    }
    if (run !== flushRun) return;

    if (outcome === null || outcome.kind === 'drop_batch') {
      // Sent (or refused for good): keep only what arrived meanwhile.
      pending = pending.filter((fix) => fix.ts > newestTs);
      nextPostAt = Date.now() + LOCATION_POST_MIN_INTERVAL_MS;
      continue;
    }
    if (outcome.kind === 'stop') {
      // 404 (no such trip / not its driver / an older backend without the
      // route), 409 (no longer IN_PROGRESS), or no session left. Quietly —
      // the foreground socket path is unaffected.
      await stopDriverLocationSharing(outcome.reason, tripId);
      return;
    }
    // Keep the fixes; the next delivery (or this one's successor) retries.
    nextPostAt =
      Date.now() + (outcome.kind === 'rate_limited' ? LOCATION_RATE_LIMIT_BACKOFF_MS : LOCATION_POST_MIN_INTERVAL_MS);
    return;
  }
}
