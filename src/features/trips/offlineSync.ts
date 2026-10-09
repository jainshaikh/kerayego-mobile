import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { tripsApi } from '../../api/trips.api';
import { isRetryableErrorKind, normalizeApiError, type ApiErrorKind } from '../../api/errors';
import {
  OFFLINE_QUEUE_MAX_ATTEMPTS,
  createQueuedAction,
  dismissDroppedActions,
  dropQueuedAction,
  enqueueTripAction,
  getDroppedActions,
  getQueuedActionsForTrip,
  getQueuedActionsForUser,
  pruneQueue,
  recordFailedAttempt,
  removeQueuedAction,
  subscribeQueueChanges,
  type DroppedTripAction,
  type QueuedTripAction,
  type TripActionDraft,
} from '../../storage/offline-trip-queue';
import { TripStatus } from '../../types/enums';

const FLUSH_INTERVAL_MS = 15_000;

// Only so many already-applied actions are remembered for the overlay; the
// oldest belong to trips whose server data caught up long ago.
const APPLIED_MEMORY_LIMIT = 200;

export interface OfflineTripQueue {
  // This user's actions for this trip still waiting to sync, oldest first.
  pendingCount: number;
  pendingItems: QueuedTripAction[];
  // Actions for this trip that reached the server this session (replayed, or
  // succeeded on the first try) — kept so the screen doesn't flicker back
  // while its refetch catches up. Overlay input only.
  appliedItems: TripActionDraft[];
  // Discarded instead of synced, until the user dismisses the notice.
  droppedActions: DroppedTripAction[];
  flushing: boolean;
  flushNow: () => Promise<void>;
  enqueue: (draft: TripActionDraft) => Promise<void>;
  countPending: () => Promise<number>;
  recordApplied: (draft: TripActionDraft) => void;
  dismissDropped: () => Promise<void>;
}

export type TripActionQueue = Pick<OfflineTripQueue, 'enqueue' | 'countPending' | 'recordApplied'>;

export interface OfflineActionCallbacks<T> {
  onSuccess?: (result: T) => void | Promise<void>;
  onQueued?: () => void | Promise<void>;
}

const QUEUE_SAVE_FAILED = "Couldn't save this action to send later. Please try again.";

// ─── Session state (module-level, shared by every screen and the global flusher) ─

// The signed-in user whose queue may be replayed right now — set by
// AuthProvider at login/bootstrap and cleared when the session ends, so a
// flush still running for the previous account stops instead of sending that
// account's actions (or reading its failures) under the next account's token.
let queueOwner: string | null = null;

interface AppliedAction {
  userId: string;
  action: TripActionDraft;
}

interface SessionSnapshot {
  applied: readonly AppliedAction[];
  flushing: ReadonlySet<string>;
}

// Immutable snapshot, replaced on every change, read through
// useSyncExternalStore.
let session: SessionSnapshot = { applied: [], flushing: new Set() };
const sessionListeners = new Set<() => void>();

function updateSession(next: Partial<SessionSnapshot>): void {
  session = { ...session, ...next };
  sessionListeners.forEach((listener) => listener());
}

function subscribeSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function getSessionSnapshot(): SessionSnapshot {
  return session;
}

/** For AuthProvider only: whose queued actions may be replayed (null: nobody's). */
export function setOfflineQueueOwner(userId: string | null): void {
  if (userId === queueOwner) return;
  queueOwner = userId;
  // The previous session's overlays mean nothing to the next one.
  updateSession({ applied: [] });
}

function isQueueOwner(userId: string): boolean {
  return queueOwner === userId;
}

function recordAppliedAction(userId: string, action: TripActionDraft): void {
  updateSession({ applied: [...session.applied, { userId, action }].slice(-APPLIED_MEMORY_LIMIT) });
}

function queueKey(userId: string, tripId: string): string {
  return `${userId}:${tripId}`;
}

function setFlushing(key: string, flushing: boolean): void {
  const next = new Set(session.flushing);
  if (flushing) next.add(key);
  else next.delete(key);
  updateSession({ flushing: next });
}

// ─── Running a new action ────────────────────────────────────────────────────

/**
 * Runs a day-of-trip mutation; on a genuine error, reports it via
 * `setActionError`. On a NETWORK error specifically, queues
 * `buildOfflineAction()` for later replay (see flushOnce) instead of
 * surfacing a failure — this is what lets a driver/rider keep working through
 * low-signal stretches of a route. Shared by useDriverTripActions and
 * useRiderTripActions, which would otherwise each repeat this same
 * try/catch/enqueue shape per action.
 *
 * While older actions for the same trip are still queued, a new one is
 * queued behind them instead of being sent directly — the queue is one
 * strict FIFO per trip. Otherwise a tap made just after the signal returns
 * could beat earlier queued taps to the server (a DROPOFF before its PICKUP,
 * or an End that gets every queued pickup refused).
 */
export async function runTripAction<T>(
  mutate: () => Promise<T>,
  queue: TripActionQueue,
  buildOfflineAction: () => TripActionDraft,
  setActionError: (message: string | null) => void,
  callbacks: OfflineActionCallbacks<T> = {},
): Promise<void> {
  setActionError(null);

  const queueAction = async (failureMessage: string) => {
    try {
      await queue.enqueue(buildOfflineAction());
    } catch {
      setActionError(failureMessage);
      return;
    }
    await callbacks.onQueued?.();
  };

  const pendingAhead = await queue.countPending().catch(() => 0);
  if (pendingAhead > 0) {
    await queueAction(QUEUE_SAVE_FAILED);
    return;
  }

  try {
    const result = await mutate();
    queue.recordApplied(buildOfflineAction());
    await callbacks.onSuccess?.(result);
  } catch (error) {
    const normalized = normalizeApiError(error);
    if (normalized.kind === 'network') {
      await queueAction(normalized.message);
    } else {
      setActionError(normalized.message);
    }
  }
}

// ─── Replaying the queue ─────────────────────────────────────────────────────

export interface FlushResult {
  flushed: number;
  failed: number;
  applied: QueuedTripAction[];
  dropped: DroppedTripAction[];
  // Stopped at an action that failed for a transient reason (still queued).
  blocked: boolean;
}

type ReplayOutcome =
  | { outcome: 'applied' }
  | { outcome: 'retry'; kind: ApiErrorKind }
  | { outcome: 'rejected'; message: string };

// The current backend makes start/end idempotent (a repeat on a trip that's
// already IN_PROGRESS / COMPLETED returns 200), but an older one answers a
// repeat with a 400 — so a refusal is checked against the trip's real status
// before it's believed. Only IN_PROGRESS/COMPLETED mean a start went through;
// a CANCELLED or SUSPENDED trip was never started by it.
async function reconcileStartOrEnd(action: QueuedTripAction, refusal: string): Promise<ReplayOutcome> {
  try {
    const trip = await tripsApi.getMineOne(action.tripId);
    const applied =
      action.kind === 'start'
        ? trip.status === TripStatus.IN_PROGRESS || trip.status === TripStatus.COMPLETED
        : trip.status === TripStatus.COMPLETED;
    return applied ? { outcome: 'applied' } : { outcome: 'rejected', message: refusal };
  } catch (error) {
    const normalized = normalizeApiError(error);
    // Couldn't check (offline, 5xx…) — try again later. A 403/404 means the
    // trip isn't this user's to start or end: nothing would ever change that.
    if (isRetryableErrorKind(normalized.kind)) return { outcome: 'retry', kind: normalized.kind };
    return { outcome: 'rejected', message: refusal };
  }
}

async function replay(action: QueuedTripAction): Promise<ReplayOutcome> {
  try {
    if (action.kind === 'start') {
      await tripsApi.startTrip(action.tripId);
    } else if (action.kind === 'end') {
      await tripsApi.endTrip(action.tripId);
    } else {
      // Idempotent by payload.id — the backend answers a replay of an event
      // it already stored (same id, same caller, same content) with that
      // stored event, even after the trip has ended.
      await tripsApi.recordEvent(action.tripId, action.payload);
    }
    return { outcome: 'applied' };
  } catch (error) {
    const normalized = normalizeApiError(error);
    if (isRetryableErrorKind(normalized.kind)) return { outcome: 'retry', kind: normalized.kind };
    if (action.kind === 'event') return { outcome: 'rejected', message: normalized.message };
    return reconcileStartOrEnd(action, normalized.message);
  }
}

/**
 * Replays one user's queued actions for one trip in FIFO order — order
 * matters (a queued PICKUP must reach the server before a queued DROPOFF for
 * the same rider). First discards anything past its retention (24 h, or out
 * of attempts). Then, per action:
 * - applied → removed;
 * - a transient failure (network, 5xx, 429, 401) → kept, attempt recorded,
 *   and the flush stops there, leaving it and everything after it queued;
 * - refused (400/403/404/409, after start/end reconciliation) → discarded
 *   and recorded for the user's notice; the flush carries on.
 * Exported so offlineSync.test.ts can drive it directly; screens go through
 * the hooks below.
 */
export async function flushOnce(tripId: string, userId: string, now: () => number = Date.now): Promise<FlushResult> {
  const applied: QueuedTripAction[] = [];
  const dropped: DroppedTripAction[] = [];
  let blocked = false;

  if (isQueueOwner(userId)) {
    const expired = await pruneQueue(now());
    dropped.push(...expired.filter((entry) => entry.userId === userId && entry.tripId === tripId));

    for (const action of await getQueuedActionsForTrip(tripId, userId, now())) {
      // The session changed hands mid-flush: what's left isn't the signed-in user's.
      if (!isQueueOwner(userId)) break;
      const result = await replay(action);

      if (result.outcome === 'applied') {
        // Overlay before removal, so the action never disappears from the
        // screen between leaving the queue and the refetch landing.
        recordAppliedAction(userId, action);
        await removeQueuedAction(action.id);
        applied.push(action);
        continue;
      }
      // A failure that arrives after a logout may have been answered for the
      // next account's token — don't act on it.
      if (!isQueueOwner(userId)) break;

      if (result.outcome === 'retry') {
        blocked = true;
        const updated = await recordFailedAttempt(action.id, result.kind, now());
        if (updated && updated.attemptCount >= OFFLINE_QUEUE_MAX_ATTEMPTS) {
          dropped.push(await dropQueuedAction(updated, 'max_attempts', null, now()));
        }
        break;
      }

      dropped.push(await dropQueuedAction(action, 'rejected', result.message, now()));
    }
  }

  return { flushed: applied.length, failed: dropped.length, applied, dropped, blocked };
}

function invalidateAfterFlush(queryClient: QueryClient, tripId: string, result: FlushResult): void {
  queryClient.invalidateQueries({ queryKey: ['myTrips'] });
  queryClient.invalidateQueries({ queryKey: ['myTrip', tripId] });
  queryClient.invalidateQueries({ queryKey: ['tripManifest', tripId] });
  queryClient.invalidateQueries({ queryKey: ['myActiveRide'] });
  const inquiryIds = new Set<string>();
  result.applied.forEach((action) => {
    if (action.kind === 'event' && action.payload.tripInquiryId) inquiryIds.add(action.payload.tripInquiryId);
  });
  result.dropped.forEach((entry) => {
    if (entry.tripInquiryId) inquiryIds.add(entry.tripInquiryId);
  });
  inquiryIds.forEach((id) => queryClient.invalidateQueries({ queryKey: ['tripInquiry', id] }));
}

interface FlushRun {
  promise: Promise<void>;
  rerun: boolean;
}

const runs = new Map<string, FlushRun>();

/**
 * Single-flight flush of one user's trip queue, shared by the trip screens
 * and the global flusher. A call that arrives mid-flush (e.g. right after a
 * new enqueue) joins it and asks for one more pass, so an action queued
 * behind a flush that already read the list still goes out now — unless that
 * flush stopped at a transient failure, in which case the next trigger
 * retries.
 */
export function flushTripQueue(tripId: string, userId: string, queryClient: QueryClient): Promise<void> {
  const key = queueKey(userId, tripId);
  const existing = runs.get(key);
  if (existing) {
    existing.rerun = true;
    return existing.promise;
  }

  const run: FlushRun = { promise: Promise.resolve(), rerun: false };
  run.promise = (async () => {
    setFlushing(key, true);
    try {
      for (;;) {
        run.rerun = false;
        const result = await flushOnce(tripId, userId);
        if (result.flushed > 0 || result.failed > 0) invalidateAfterFlush(queryClient, tripId, result);
        if (!run.rerun || result.blocked) break;
      }
    } catch (error) {
      console.warn('[offlineSync] flushing the trip action queue failed:', error);
    } finally {
      runs.delete(key);
      setFlushing(key, false);
    }
  })();
  runs.set(key, run);
  return run.promise;
}

/** Flushes every trip this user has queued actions for, one trip at a time. */
export async function flushAllTripQueues(userId: string, queryClient: QueryClient): Promise<void> {
  let tripIds: string[];
  try {
    tripIds = [...new Set((await getQueuedActionsForUser(userId)).map((action) => action.tripId))];
  } catch (error) {
    console.warn('[offlineSync] reading the trip action queue failed:', error);
    return;
  }
  for (const tripId of tripIds) {
    await flushTripQueue(tripId, userId, queryClient);
  }
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Mounted once in RootNavigator while signed in: flushes every trip this
 * user has queued actions for — immediately, whenever the app comes back to
 * the foreground, and every 15 s — so a queued action syncs even when its
 * trip screen isn't open (e.g. a Start queued offline, then the driver left
 * the screen). This app has no background-task infra, so nothing runs once
 * the app is backgrounded.
 */
export function useGlobalOfflineQueueFlush(userId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const flushAll = () => {
      flushAllTripQueues(userId, queryClient);
    };
    flushAll();

    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') flushAll();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);
    const interval = setInterval(flushAll, FLUSH_INTERVAL_MS);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [userId, queryClient]);
}

interface QueueSnapshot {
  key: string | null;
  pending: QueuedTripAction[];
  dropped: DroppedTripAction[];
}

const EMPTY_SNAPSHOT: QueueSnapshot = { key: null, pending: [], dropped: [] };

/**
 * One trip's view of the queue for the signed-in user: what's still pending,
 * what was applied this session, and what was discarded — kept current
 * through the storage module's change notifications, whoever made the
 * change (this screen, or the global flusher). Flushes once on mount and
 * after each enqueue; the periodic and on-foreground retries are the global
 * flusher's (useGlobalOfflineQueueFlush).
 */
export function useOfflineTripQueue(tripId: string | undefined, userId: string | undefined): OfflineTripQueue {
  const queryClient = useQueryClient();
  const key = tripId && userId ? queueKey(userId, tripId) : null;
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY_SNAPSHOT);
  const sessionState = useSyncExternalStore(subscribeSession, getSessionSnapshot, getSessionSnapshot);

  useEffect(() => {
    if (!tripId || !userId) return;
    let active = true;
    let latestLoad = 0;
    // Loads can overlap (one per change notification) — only the newest
    // one's result is applied.
    const load = async () => {
      const ticket = ++latestLoad;
      try {
        const [pending, dropped] = await Promise.all([
          getQueuedActionsForTrip(tripId, userId),
          getDroppedActions(userId, tripId),
        ]);
        if (active && ticket === latestLoad) setSnapshot({ key: queueKey(userId, tripId), pending, dropped });
      } catch (error) {
        console.warn('[offlineSync] reading the trip action queue failed:', error);
      }
    };
    load();
    const unsubscribe = subscribeQueueChanges(load);
    // Opening the screen is itself a retry — e.g. the first chance after the
    // app was restarted with actions still queued.
    flushTripQueue(tripId, userId, queryClient);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [tripId, userId, queryClient]);

  const current = snapshot.key === key ? snapshot : EMPTY_SNAPSHOT;
  const appliedItems = sessionState.applied
    .filter((entry) => entry.userId === userId && entry.action.tripId === tripId)
    .map((entry) => entry.action);

  const flushNow = async () => {
    if (tripId && userId) await flushTripQueue(tripId, userId, queryClient);
  };

  const enqueue = async (draft: TripActionDraft) => {
    if (!userId) throw new Error('Queued trip actions need a signed-in user');
    await enqueueTripAction(createQueuedAction(draft, userId));
    flushNow();
  };

  const countPending = async () => (tripId && userId ? (await getQueuedActionsForTrip(tripId, userId)).length : 0);

  const recordApplied = (draft: TripActionDraft) => {
    if (userId) recordAppliedAction(userId, draft);
  };

  const dismissDropped = async () => {
    if (tripId && userId) await dismissDroppedActions(userId, tripId);
  };

  return {
    pendingCount: current.pending.length,
    pendingItems: current.pending,
    appliedItems,
    droppedActions: current.dropped,
    flushing: key !== null && sessionState.flushing.has(key),
    flushNow,
    enqueue,
    countPending,
    recordApplied,
    dismissDropped,
  };
}
