import { AxiosError } from 'axios';

import { normalizeApiError } from '../../../api/errors';
import type { LocationShareTargetRef } from '../../../api/location-sharing.api';
import type { ApiErrorBody, LocationShareTarget, MyLocationSharing } from '../../../types/api.types';
import type { ActiveCustomerShare } from '../../../storage/active-customer-share';
import { titleCase } from '../../../utils/format';
import type { LocationPostOutcome as DriverLocationPostOutcome } from './backgroundLocationRules';

// Pure rules for the customer's location sharing (customerLocationSharing.ts
// + useCustomerLocationReconcile.ts) — a carpool rider or a rental customer
// sharing their position with their driver until pickup. No native module,
// storage or network in here, so every decision is unit-tested directly.
// The backend alone decides when a window is open (GET /users/me/location-
// sharing); these rules only decide what the app does with its answers.

// Cadence: one fix every ~10 s, in the foreground and the background alike
// (there's no socket path for customers). distanceInterval 0 on purpose: a
// customer usually stands still waiting for the car, and a distance filter
// would stop the fixes — the driver stops seeing a stored position once it's
// 15 minutes old (the backend's SHARED_LOCATION_MAX_AGE_MIN). timeInterval is
// Android-only; iOS delivers continuously and the POST throttle
// (LOCATION_POST_MIN_INTERVAL_MS, shared with the driver task) spaces it out.
export const CUSTOMER_LOCATION_INTERVAL_MS = 10_000;
export const CUSTOMER_LOCATION_DISTANCE_M = 0;

// The client keeps at most this many unsent fixes (the endpoint takes 1–30;
// the backend stores only the newest).
export const CUSTOMER_LOCATION_BATCH_MAX = 20;

// The reconcile asks GET /users/me/location-sharing this often while the app
// is open (and on every return to the foreground, and at nextOpensAt).
export const LOCATION_SHARING_POLL_MS = 60_000;

// After the server refused a target (404/403/409), the app doesn't start it
// again for this long even if GET still lists it open — a window that just
// closed on the server can take a poll to disappear from the list, and this
// keeps that from turning into a start/stop loop. Resume / Try again clears it.
export const SERVER_STOP_RETRY_AFTER_MS = 2 * 60_000;

// nextOpensAt: check this long after the window opens (server and device
// clocks differ a little), but never sooner than MIN, and a time further out
// than MAX is left to the regular poll.
export const NEXT_OPENS_AT_SLACK_MS = 2_000;
export const NEXT_OPENS_AT_MIN_DELAY_MS = 1_000;
export const NEXT_OPENS_AT_MAX_DELAY_MS = 24 * 60 * 60_000;

// The backend's 409 codes on POST …/location.
export const LOCATION_SHARING_CLOSED = 'LOCATION_SHARING_CLOSED';
export const LOCATION_SHARING_PAUSED = 'LOCATION_SHARING_PAUSED';

export function shareTargetKey(target: LocationShareTargetRef): string {
  return `${target.kind}:${target.id}`;
}

export function sameShareTarget(
  a: LocationShareTargetRef | null | undefined,
  b: LocationShareTargetRef | null | undefined,
): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

// Why customer sharing stopped. The server's verdicts on a target
// (SERVER_STOP_REASONS) also keep it from restarting for
// SERVER_STOP_RETRY_AFTER_MS.
export type CustomerLocationStopReason =
  // The customer pressed Stop (PATCH …{ paused: true }), here or elsewhere.
  | 'paused'
  // Logout, or the session expired.
  | 'signed_out'
  // A different account is signed in than the one that started sharing.
  | 'other_user'
  // The task fired with no target recorded — a leftover registration.
  | 'no_active_target'
  // The task fired in the background in a JS runtime with no session (an OS
  // wake-up without the app's UI).
  | 'no_session'
  // GET /users/me/location-sharing no longer lists the target: the window
  // closed (picked up, ride over, cancelled, too late).
  | 'window_closed'
  // Another target is the one to share now.
  | 'target_changed'
  // This person is driving a carpool trip — the driver task shares for them.
  | 'driver_sharing'
  // POST …/location: 404 (not found / not yours / older backend).
  | 'target_not_found'
  // POST …/location: 403.
  | 'target_forbidden'
  // POST …/location: 409 LOCATION_SHARING_CLOSED (or a 409 without a known code).
  | 'sharing_closed'
  // POST …/location: 409 LOCATION_SHARING_PAUSED.
  | 'sharing_paused'
  // POST …/location: 401 even after the token refresh.
  | 'session_rejected';

const SERVER_STOP_REASONS: ReadonlySet<CustomerLocationStopReason> = new Set<CustomerLocationStopReason>([
  'target_not_found',
  'target_forbidden',
  'sharing_closed',
  'sharing_paused',
  'session_rejected',
]);

/** Whether a stop was the server's verdict on the target (it isn't restarted for a while). */
export function isCustomerServerStopReason(reason: CustomerLocationStopReason): boolean {
  return SERVER_STOP_REASONS.has(reason);
}

/** Whether a server stop at `stoppedAt` still keeps its target from being started at `nowMs`. */
export function isServerStopStillBlocking(stoppedAt: number | undefined, nowMs: number): boolean {
  if (stoppedAt === undefined) return false;
  const elapsed = nowMs - stoppedAt;
  // A negative gap means the clock went backwards — don't block forever.
  return elapsed >= 0 && elapsed < SERVER_STOP_RETRY_AFTER_MS;
}

export type CustomerTaskRunDecision =
  // Nothing to decide yet (the session is still being restored in the foreground).
  | { kind: 'skip' }
  | { kind: 'stop'; reason: CustomerLocationStopReason }
  | { kind: 'send'; share: ActiveCustomerShare };

/**
 * What the customer task does with a delivery of fixes. Unlike the driver's
 * task it sends in the foreground too. With no session: in the foreground the
 * session may still be being restored (the reconcile decides once it is); in
 * the background it's an OS wake-up without the UI — stop.
 */
export function decideCustomerTaskRun(input: {
  appInForeground: boolean;
  share: ActiveCustomerShare | null;
  sessionUserId: string | null;
  driverSharing: boolean;
}): CustomerTaskRunDecision {
  const { appInForeground, share, sessionUserId, driverSharing } = input;
  if (!share) return { kind: 'stop', reason: 'no_active_target' };
  if (sessionUserId === null) return appInForeground ? { kind: 'skip' } : { kind: 'stop', reason: 'no_session' };
  if (sessionUserId !== share.userId) return { kind: 'stop', reason: 'other_user' };
  if (driverSharing) return { kind: 'stop', reason: 'driver_sharing' };
  return { kind: 'send', share };
}

export type CustomerLocationPostOutcome =
  | { kind: 'stop'; reason: CustomerLocationStopReason }
  | Exclude<DriverLocationPostOutcome, { kind: 'stop' }>;

function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof AxiosError)) return undefined;
  const body = error.response?.data as Partial<ApiErrorBody> | undefined;
  return typeof body?.error?.code === 'string' ? body.error.code : undefined;
}

/**
 * What a failed POST …/location means (contract: 404/403/409 stop that target
 * and re-check; 429/5xx/network keep the fixes and retry). A 401 has already
 * been through the shared token refresh — there's no session left.
 */
export function classifyCustomerLocationPostError(error: unknown): CustomerLocationPostOutcome {
  switch (normalizeApiError(error).kind) {
    case 'not_found':
      return { kind: 'stop', reason: 'target_not_found' };
    case 'forbidden':
      return { kind: 'stop', reason: 'target_forbidden' };
    case 'conflict':
      return {
        kind: 'stop',
        reason: apiErrorCode(error) === LOCATION_SHARING_PAUSED ? 'sharing_paused' : 'sharing_closed',
      };
    case 'unauthorized':
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
 * The window to share for: the one already being shared while it's still
 * open and not paused (one at a time — never switch away from it), else the
 * first open, non-paused one the server lists that isn't blocked.
 */
export function pickShareTarget(
  targets: readonly LocationShareTarget[],
  current: LocationShareTargetRef | null,
  isBlocked: (target: LocationShareTarget) => boolean,
): LocationShareTarget | null {
  const eligible = (target: LocationShareTarget) => !target.paused && !isBlocked(target);
  const kept = current ? targets.find((target) => sameShareTarget(target, current)) : undefined;
  if (kept && eligible(kept)) return kept;
  return targets.find(eligible) ?? null;
}

export interface CustomerReconcilePlan {
  // Stop the stored share first, for this reason.
  stop: CustomerLocationStopReason | null;
  // Then make sure this target is shared (from the foreground only).
  start: LocationShareTarget | null;
}

const NOTHING: CustomerReconcilePlan = { stop: null, start: null };

/**
 * What the app-wide reconcile does with the stored share and the latest GET
 * /users/me/location-sharing answer. `userId` is undefined while the session
 * is being restored (no decision); `sharing` is undefined until the query
 * has answered (stops for the account changing still apply).
 */
export function planCustomerReconcile(input: {
  share: ActiveCustomerShare | null;
  userId: string | null | undefined;
  sharing: MyLocationSharing | undefined;
  isBlocked: (target: LocationShareTarget) => boolean;
  driverSharing: boolean;
}): CustomerReconcilePlan {
  const { userId, sharing, isBlocked, driverSharing } = input;
  if (userId === undefined) return NOTHING;
  if (userId === null) return { stop: input.share ? 'signed_out' : null, start: null };

  let stop: CustomerLocationStopReason | null = null;
  let share = input.share;
  if (share && share.userId !== userId) {
    stop = 'other_user';
    share = null;
  }
  if (driverSharing) return { stop: share ? 'driver_sharing' : stop, start: null };
  if (!sharing) return { stop, start: null };

  const start = pickShareTarget(sharing.targets, share, isBlocked);
  if (share && !sameShareTarget(share, start)) {
    const listed = sharing.targets.find((target) => sameShareTarget(target, share));
    stop = !listed ? 'window_closed' : listed.paused ? 'paused' : 'target_changed';
  }
  return { stop, start };
}

/** How long until the app should ask again because a window opens (`nextOpensAt`), or null to leave it to the poll. */
export function nextOpensAtDelayMs(nextOpensAt: string | null | undefined, nowMs: number): number | null {
  if (!nextOpensAt) return null;
  const opensAt = Date.parse(nextOpensAt);
  if (!Number.isFinite(opensAt)) return null;
  const delay = opensAt - nowMs + NEXT_OPENS_AT_SLACK_MS;
  if (delay > NEXT_OPENS_AT_MAX_DELAY_MS) return null;
  return Math.max(NEXT_OPENS_AT_MIN_DELAY_MS, delay);
}

/**
 * A window's label for display. A carpool label is the trip's cities exactly
 * as stored ("lahore → islamabad"), title-cased like the rider screens do; a
 * rental label is the vehicle's own title, shown as is.
 */
export function shareTargetDisplayLabel(target: Pick<LocationShareTarget, 'kind' | 'label'>): string {
  return target.kind === 'TRIP_INQUIRY' ? titleCase(target.label) : target.label;
}

/** The listed target for `ref`, if the server says its window is open now. */
export function findShareTarget(
  sharing: MyLocationSharing | undefined,
  ref: LocationShareTargetRef,
): LocationShareTarget | null {
  return sharing?.targets.find((target) => sameShareTarget(target, ref)) ?? null;
}
