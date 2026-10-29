import { AppState } from 'react-native';
import * as Location from 'expo-location';
// Type-only: erased at build time (see driverLocationSharing.ts).
import type { TaskManagerTaskBody } from 'expo-task-manager';

import {
  locationSharingApi,
  type CustomerLocationFix,
  type LocationShareTargetRef,
} from '../../../api/location-sharing.api';
import { REQUEST_TIMEOUT_MS } from '../../../constants/config';
import type { LocationShareTarget, MyLocationSharing } from '../../../types/api.types';
import {
  clearActiveCustomerShare,
  readActiveCustomerShare,
  writeActiveCustomerShare,
  type ActiveCustomerShare,
} from '../../../storage/active-customer-share';
import { readActiveDriverTrip } from '../../../storage/active-driver-trip';
import {
  LOCATION_POST_MIN_INTERVAL_MS,
  LOCATION_RATE_LIMIT_BACKOFF_MS,
  isForegroundAppState,
  locationPostWaitMs,
  mergePendingFixes,
  toDriverLocationFix,
} from './backgroundLocationRules';
import {
  CUSTOMER_LOCATION_BATCH_MAX,
  CUSTOMER_LOCATION_DISTANCE_M,
  CUSTOMER_LOCATION_INTERVAL_MS,
  classifyCustomerLocationPostError,
  decideCustomerTaskRun,
  isCustomerServerStopReason,
  isServerStopStillBlocking,
  planCustomerReconcile,
  sameShareTarget,
  shareTargetKey,
  type CustomerLocationPostOutcome,
  type CustomerLocationStopReason,
} from './customerLocationRules';
import {
  getBackgroundLocationStatus,
  isBackgroundLocationSupported,
  setBeforeDriverLocationStart,
} from './driverLocationSharing';

// ─── Customer location until pickup ────────────────────────────────────────
// A carpool rider (TRIP_INQUIRY) or a rental customer (BOOKING) shares their
// position with their driver while the backend says the sharing window is
// open — until pickup. An expo-location task (task name below) — an Android
// foreground service with its "Sharing your location" notification; iOS's
// background location mode, blue indicator — delivers a fix about every
// 10 s, and the task POSTs them (POST /trip-inquiries/:id/location or
// /booking-requests/:id/customer-location) in the foreground and the
// background alike: customers have no socket path. Same owner decisions as
// the driver's task (driverLocationSharing.ts): When-In-Use permission only,
// and only while the app's process is alive (killServiceOnDestroy).
//
// Separate from the carpool driver's task and never at the same time for
// the same person: it doesn't start while the driver task shares, and stops
// if that starts. One window at a time. Which one, and whose:
// storage/active-customer-share.ts.
//
// Started from the foreground only (Android refuses a location foreground
// service from the background) by the app-wide reconcile
// (useCustomerLocationReconcile) for the first open, non-paused window GET
// /users/me/location-sharing lists. Stops on Stop (pause), logout/expiry
// (AuthProvider), the window closing or changing, another account, or the
// location endpoint answering 404/403/409.

export const CUSTOMER_LOCATION_TASK = 'kerayego.customer-location';

const FLUSH_STALE_MS = LOCATION_POST_MIN_INTERVAL_MS + 2 * REQUEST_TIMEOUT_MS;

export type CustomerLocationFailure =
  // This build has no background location support (Expo Go, web, a binary
  // built before expo-task-manager).
  | 'unavailable'
  // startLocationUpdatesAsync failed (retryable).
  | 'start_failed'
  // Location permission isn't granted (denied, or the explanation was dismissed).
  | 'permission';

export type CustomerLocationStatus =
  | { state: 'idle' }
  | { state: 'starting' | 'running'; target: LocationShareTargetRef }
  | { state: 'failed'; target: LocationShareTargetRef; reason: CustomerLocationFailure }
  | { state: 'stopped'; target: LocationShareTargetRef | null; reason: CustomerLocationStopReason };

interface CustomerLocationTaskData {
  locations?: Location.LocationObject[];
}

// ─── Module state (one JS runtime) ─────────────────────────────────────────

let status: CustomerLocationStatus = { state: 'idle' };
const statusListeners = new Set<() => void>();

// The signed-in user in THIS JS runtime, set by AuthProvider.
let sessionUserId: string | null = null;

// Targets the server refused, with when (device clock) — not started again
// until SERVER_STOP_RETRY_AFTER_MS has passed, or the customer resumes/retries.
const serverStoppedTargets = new Map<string, number>();

let lifecycle = 0;
let startInFlight: { key: string; promise: Promise<void> } | null = null;

let pending: CustomerLocationFix[] = [];
let nextPostAt = 0;
let flushRun = 0;
let flushing: { run: number; startedAt: number } | null = null;

// "Try again" / "Turn on" from a screen: the reconcile hook re-runs on it.
let retryCount = 0;
const retryListeners = new Set<() => void>();

function setStatus(next: CustomerLocationStatus): void {
  status = next;
  statusListeners.forEach((listener) => listener());
}

function statusTarget(): LocationShareTargetRef | null {
  return 'target' in status ? status.target : null;
}

function toRef(target: LocationShareTargetRef): LocationShareTargetRef {
  return { kind: target.kind, id: target.id };
}

export function getCustomerLocationStatus(): CustomerLocationStatus {
  return status;
}

export function subscribeCustomerLocationStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getCustomerSharingRetryCount(): number {
  return retryCount;
}

export function subscribeCustomerSharingRetry(listener: () => void): () => void {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}

/**
 * A screen's "Try again" (after start_failed) or "Turn on" (permission): lets
 * the target be started again even if the server refused it a moment ago,
 * and has the reconcile re-run (it re-asks for permission when it can).
 */
export function requestCustomerSharingRetry(target: LocationShareTargetRef): void {
  serverStoppedTargets.delete(shareTargetKey(target));
  retryCount += 1;
  retryListeners.forEach((listener) => listener());
}

/** AuthProvider: who is signed in — on login and session restore, and null when the session ends. */
export function setCustomerLocationSessionUser(userId: string | null): void {
  if (userId === sessionUserId) return;
  sessionUserId = userId;
  serverStoppedTargets.clear();
}

/** Whether the server refused this target recently (404/403/409) — it isn't started again yet. */
export function isCustomerTargetBlocked(target: LocationShareTargetRef, nowMs: number = Date.now()): boolean {
  return isServerStopStillBlocking(serverStoppedTargets.get(shareTargetKey(target)), nowMs);
}

/** The customer resumed this target (PATCH paused: false): forget an earlier refusal. */
export function clearCustomerTargetBlock(target: LocationShareTargetRef): void {
  serverStoppedTargets.delete(shareTargetKey(target));
}

/** Whether this person's carpool driver task is (or is about to be) sharing — the customer task stays off then. */
export async function isDriverSharingActive(): Promise<boolean> {
  const driverStatus = getBackgroundLocationStatus();
  if (driverStatus.state === 'starting' || driverStatus.state === 'running') return true;
  try {
    return (await readActiveDriverTrip()) !== null;
  } catch {
    return false;
  }
}

/** The reconcile couldn't get location permission for this target (denied, or the explanation was dismissed). */
export function reportCustomerLocationPermissionMissing(target: LocationShareTargetRef): void {
  // Never over a running share (permission is checked before each start).
  if ((status.state === 'running' || status.state === 'starting') && sameShareTarget(status.target, target)) return;
  setStatus({ state: 'failed', target: toRef(target), reason: 'permission' });
}

/**
 * iOS: the blue indicator. Android: the foreground service and its ongoing
 * notification, ended when the app is swiped away. Accuracy High: the driver
 * has to find the person at a kerb — Balanced is a ~100 m city-block fix on
 * both platforms, too coarse for that; the window is short (it closes at
 * pickup), which bounds the battery cost.
 */
function customerLocationTaskOptions(): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy.High,
    timeInterval: CUSTOMER_LOCATION_INTERVAL_MS,
    distanceInterval: CUSTOMER_LOCATION_DISTANCE_M,
    // iOS: a person on foot or standing — and never paused, or iOS stops
    // updates while they wait and doesn't resume them until the app opens.
    activityType: Location.ActivityType.Other,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Sharing your location',
      notificationBody: 'KerayeGo is sharing your location with your driver until pickup',
      killServiceOnDestroy: true,
    },
  };
}

async function hasStartedUpdates(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(CUSTOMER_LOCATION_TASK);
  } catch {
    return false;
  }
}

async function stopUpdatesQuietly(): Promise<void> {
  if (!isBackgroundLocationSupported()) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(CUSTOMER_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(CUSTOMER_LOCATION_TASK);
    }
  } catch (error) {
    console.warn('[customerLocation] failed to stop location updates:', error);
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
 * Starts sharing for this target — or confirms it's still running. Call only
 * from the foreground with location permission granted. Never throws; a
 * failure shows in the status ('failed'). Doesn't start while the driver
 * task shares, or for a target the server just refused.
 */
export function ensureCustomerLocationSharing(target: LocationShareTargetRef, userId: string): Promise<void> {
  const key = shareTargetKey(target);
  if (startInFlight?.key === key) return startInFlight.promise;
  const promise = startSharing(toRef(target), userId).finally(() => {
    if (startInFlight?.promise === promise) startInFlight = null;
  });
  startInFlight = { key, promise };
  return promise;
}

function mayStart(target: LocationShareTargetRef, userId: string): boolean {
  return !isCustomerTargetBlocked(target) && sessionUserId === userId;
}

async function startSharing(target: LocationShareTargetRef, userId: string): Promise<void> {
  if (!mayStart(target, userId)) return;
  if (!isBackgroundLocationSupported()) {
    setStatus({ state: 'failed', target, reason: 'unavailable' });
    return;
  }
  if (await isDriverSharingActive()) {
    // The driver task shares for this person — say so (once) instead.
    if (!(status.state === 'stopped' && status.reason === 'driver_sharing' && sameShareTarget(status.target, target))) {
      setStatus({ state: 'stopped', target, reason: 'driver_sharing' });
    }
    return;
  }
  if (status.state === 'running' && sameShareTarget(status.target, target) && (await hasStartedUpdates())) return;
  if (!mayStart(target, userId)) return;

  const run = ++lifecycle;
  setStatus({ state: 'starting', target });
  try {
    const stored = await readActiveCustomerShare();
    const sameShare = !!stored && sameShareTarget(stored, target) && stored.userId === userId;
    if (!sameShare) resetSender();
    const startedAt = sameShare && stored ? stored.startedAt : Date.now();
    // The record first, the registration second: a fix delivered the moment
    // the task is registered must already know its target.
    await writeActiveCustomerShare({ kind: target.kind, id: target.id, userId, startedAt });
    if (run !== lifecycle) {
      await clearActiveCustomerShare();
      return;
    }
    await Location.startLocationUpdatesAsync(CUSTOMER_LOCATION_TASK, customerLocationTaskOptions());
    if (run !== lifecycle) {
      await Promise.all([stopUpdatesQuietly(), clearActiveCustomerShare()]);
      return;
    }
    setStatus({ state: 'running', target });
  } catch (error) {
    console.warn('[customerLocation] location updates failed to start:', error);
    if (run !== lifecycle) return;
    if (!(await hasStartedUpdates())) await clearActiveCustomerShare().catch(() => undefined);
    if (run !== lifecycle) return;
    setStatus({ state: 'failed', target, reason: 'start_failed' });
  }
}

/**
 * Stops sharing (if running) and forgets the target. Idempotent; never
 * throws. A server verdict also keeps `target` from restarting for a while.
 */
export async function stopCustomerLocationSharing(
  reason: CustomerLocationStopReason,
  target: LocationShareTargetRef | null = null,
): Promise<void> {
  lifecycle += 1;
  resetSender();
  const stoppedTarget = target ? toRef(target) : statusTarget();
  if (stoppedTarget && isCustomerServerStopReason(reason)) {
    serverStoppedTargets.set(shareTargetKey(stoppedTarget), Date.now());
  }
  setStatus({ state: 'stopped', target: stoppedTarget, reason });
  await Promise.all([
    clearActiveCustomerShare().catch((error) => {
      console.warn('[customerLocation] failed to clear the active customer share:', error);
    }),
    stopUpdatesQuietly(),
  ]);
}

/** Stops sharing only if it's this target's — what Stop on a screen does. */
export async function stopCustomerLocationSharingFor(
  target: LocationShareTargetRef,
  reason: CustomerLocationStopReason,
): Promise<void> {
  const current = statusTarget();
  const ownedHere = (status.state === 'starting' || status.state === 'running') && sameShareTarget(current, target);
  let stored: ActiveCustomerShare | null = null;
  if (!ownedHere) {
    try {
      stored = await readActiveCustomerShare();
    } catch {
      return;
    }
  }
  if (ownedHere || sameShareTarget(stored, target)) await stopCustomerLocationSharing(reason, target);
}

/**
 * App-wide check (useCustomerLocationReconcile): stops the stored share when
 * it no longer belongs (signed out, another account, its window closed or
 * paused, the driver task sharing) and a registration left behind with no
 * target; returns the target the caller should start (from the foreground,
 * with permission) — or null.
 */
export async function reconcileCustomerLocationSharing(input: {
  userId: string | null | undefined;
  sharing: MyLocationSharing | undefined;
}): Promise<LocationShareTarget | null> {
  if (!isBackgroundLocationSupported()) {
    // Nothing can be registered in this build — but the target still goes
    // back to the caller, whose start attempt reports 'unavailable'.
    return planCustomerReconcile({ share: null, ...input, isBlocked: () => false, driverSharing: false }).start;
  }
  const run = lifecycle;
  let share: ActiveCustomerShare | null;
  let driverSharing: boolean;
  try {
    [share, driverSharing] = await Promise.all([readActiveCustomerShare(), isDriverSharingActive()]);
  } catch {
    return null;
  }
  if (run !== lifecycle) return null;

  const plan = planCustomerReconcile({
    share,
    userId: input.userId,
    sharing: input.sharing,
    isBlocked: (target) => isCustomerTargetBlocked(target),
    driverSharing,
  });
  if (plan.stop) {
    await stopCustomerLocationSharing(plan.stop, share);
  } else if (!share && input.userId !== undefined && (await hasStartedUpdates()) && run === lifecycle) {
    // A registration the OS restored with no target recorded.
    await stopCustomerLocationSharing('no_active_target');
  }
  return plan.start;
}

// The carpool driver task is about to start for this person: step aside
// first, so the two never run together.
async function yieldToDriverTask(): Promise<void> {
  if (status.state === 'running' || status.state === 'starting' || (await hasStartedUpdates())) {
    await stopCustomerLocationSharing('driver_sharing');
  }
}
setBeforeDriverLocationStart(yieldToDriverTask);

// ─── The task ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The customer task's executor (registered in defineCustomerLocationTask.ts):
 * every batch of fixes the OS delivers, in the foreground or the background.
 * Resolves once its POST (if any) is done.
 */
export async function handleCustomerLocationTask({
  data,
  error,
}: Pick<TaskManagerTaskBody<CustomerLocationTaskData | undefined>, 'data' | 'error'>): Promise<void> {
  if (error) {
    console.warn('[customerLocation] location error:', error.message);
    return;
  }

  let share: ActiveCustomerShare | null;
  let driverSharing: boolean;
  try {
    [share, driverSharing] = await Promise.all([readActiveCustomerShare(), isDriverSharingActive()]);
  } catch (readError) {
    console.warn('[customerLocation] could not read the active customer share:', readError);
    return;
  }
  const decision = decideCustomerTaskRun({
    appInForeground: isForegroundAppState(AppState.currentState),
    share,
    sessionUserId,
    driverSharing,
  });
  if (decision.kind === 'skip') return;
  if (decision.kind === 'stop') {
    await stopCustomerLocationSharing(decision.reason, share);
    return;
  }

  const fixes = (data?.locations ?? [])
    .map((location) => toDriverLocationFix(location))
    .filter((fix): fix is CustomerLocationFix => fix !== null);
  if (fixes.length === 0) return;
  await deliverFixes(toRef(decision.share), fixes);
}

function deliverFixes(target: LocationShareTargetRef, fixes: CustomerLocationFix[]): Promise<void> {
  pending = mergePendingFixes(pending, fixes, CUSTOMER_LOCATION_BATCH_MAX);
  const now = Date.now();
  if (flushing && now - flushing.startedAt < FLUSH_STALE_MS) return Promise.resolve();
  flushRun += 1;
  const run = flushRun;
  flushing = { run, startedAt: now };
  return flushPending(target, run).finally(() => {
    if (flushing?.run === run) flushing = null;
  });
}

async function flushPending(target: LocationShareTargetRef, run: number): Promise<void> {
  while (pending.length > 0) {
    const wait = locationPostWaitMs(nextPostAt, Date.now());
    if (wait === null) return;
    if (wait > 0) await sleep(wait);
    if (run !== flushRun) return;

    const batch = pending;
    const newestTs = batch[batch.length - 1].ts;
    let outcome: CustomerLocationPostOutcome | null = null;
    try {
      await locationSharingApi.postLocations(target, batch);
    } catch (postError) {
      outcome = classifyCustomerLocationPostError(postError);
    }
    if (run !== flushRun) return;

    if (outcome === null || outcome.kind === 'drop_batch') {
      pending = pending.filter((fix) => fix.ts > newestTs);
      nextPostAt = Date.now() + LOCATION_POST_MIN_INTERVAL_MS;
      continue;
    }
    if (outcome.kind === 'stop') {
      // 404/403 (not this person's, or gone), 409 (window closed or paused),
      // or no session left — the reconcile re-checks GET and decides again.
      await stopCustomerLocationSharing(outcome.reason, target);
      return;
    }
    nextPostAt =
      Date.now() + (outcome.kind === 'rate_limited' ? LOCATION_RATE_LIMIT_BACKOFF_MS : LOCATION_POST_MIN_INTERVAL_MS);
    return;
  }
}
