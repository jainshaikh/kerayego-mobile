import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { tripsApi } from '../../api/trips.api';
import { normalizeApiError } from '../../api/errors';
import {
  enqueueTripAction,
  getQueuedActionsForTrip,
  removeQueuedAction,
  type QueuedTripAction,
} from '../../storage/offline-trip-queue';
import { TripStatus } from '../../types/enums';

const FLUSH_INTERVAL_MS = 15_000;

export interface OfflineTripQueue {
  pendingCount: number;
  flushing: boolean;
  flushNow: () => Promise<void>;
  enqueue: (action: QueuedTripAction) => Promise<void>;
}

export interface OfflineActionCallbacks<T> {
  onSuccess?: (result: T) => void | Promise<void>;
  onQueued?: () => void | Promise<void>;
}

/**
 * Runs a day-of-trip mutation; on a genuine error, reports it via
 * `setActionError`. On a NETWORK error specifically, queues
 * `buildOfflineAction()` for later replay (see useOfflineTripQueue's flush)
 * instead of surfacing a failure — this is what lets a driver/rider keep
 * working through low-signal stretches of a route. Shared by
 * useDriverTripActions and useRiderTripActions, which would otherwise each
 * repeat this same try/catch/enqueue shape per action.
 */
export async function runTripAction<T>(
  mutate: () => Promise<T>,
  enqueue: OfflineTripQueue['enqueue'],
  buildOfflineAction: () => QueuedTripAction,
  setActionError: (message: string | null) => void,
  callbacks: OfflineActionCallbacks<T> = {},
): Promise<void> {
  setActionError(null);
  try {
    const result = await mutate();
    await callbacks.onSuccess?.(result);
  } catch (error) {
    const normalized = normalizeApiError(error);
    if (normalized.kind === 'network') {
      await enqueue(buildOfflineAction());
      await callbacks.onQueued?.();
    } else {
      setActionError(normalized.message);
    }
  }
}

// Replays one trip's queued actions in FIFO order — order matters (a queued
// PICKUP must reach the server before a queued DROPOFF for the same rider).
// Stops at the first action that still can't reach the server at all, leaving
// it and everything after it queued for the next attempt.
async function flushOnce(tripId: string): Promise<{ flushed: number; failed: number }> {
  const queue = await getQueuedActionsForTrip(tripId);
  let flushed = 0;
  let failed = 0;

  for (const action of queue) {
    try {
      if (action.kind === 'start') {
        await tripsApi.startTrip(action.tripId);
      } else if (action.kind === 'end') {
        await tripsApi.endTrip(action.tripId);
      } else {
        // Idempotent by payload.id — a replay of an event the server already
        // recorded returns the same stored event rather than erroring, so
        // there's no "already applied" reconciliation needed for this branch.
        await tripsApi.recordEvent(action.tripId, action.payload);
      }
      await removeQueuedAction(action.id);
      flushed += 1;
      continue;
    } catch (error) {
      const normalized = normalizeApiError(error);
      if (normalized.kind === 'network') {
        break; // still offline — leave this and the rest queued, try again later
      }

      // start/end aren't idempotent (a repeat call 400s once already applied) —
      // if the app never saw the first attempt's response, reconcile against
      // the trip's actual current status instead of assuming failure.
      if (action.kind === 'start' || action.kind === 'end') {
        try {
          const trip = await tripsApi.getMineOne(action.tripId);
          const alreadyApplied =
            (action.kind === 'start' && trip.status !== TripStatus.ACTIVE) ||
            (action.kind === 'end' && trip.status === TripStatus.COMPLETED);
          if (alreadyApplied) {
            await removeQueuedAction(action.id);
            flushed += 1;
            continue;
          }
        } catch {
          break; // couldn't confirm either way — leave it queued, retry next flush
        }
      }

      // A genuine validation/permission error — retrying the same payload
      // will never succeed, so drop it rather than blocking the rest of the queue.
      await removeQueuedAction(action.id);
      failed += 1;
    }
  }

  return { flushed, failed };
}

// Drives the queue for one trip: attempts a flush on mount, whenever the app
// comes back to the foreground, and on a short interval while this screen is
// open (covers a driver on a moving route with intermittently dropping signal —
// this app has no background-task infra, so nothing runs once it's backgrounded).
export function useOfflineTripQueue(tripId: string | undefined): OfflineTripQueue {
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    if (!tripId) return;
    const queue = await getQueuedActionsForTrip(tripId);
    setPendingCount(queue.length);
  }, [tripId]);

  const flush = useCallback(async () => {
    if (!tripId || flushingRef.current) return;
    flushingRef.current = true;
    setFlushing(true);
    try {
      const { flushed, failed } = await flushOnce(tripId);
      if (flushed > 0 || failed > 0) {
        queryClient.invalidateQueries({ queryKey: ['myTrip', tripId] });
        queryClient.invalidateQueries({ queryKey: ['tripManifest', tripId] });
      }
      await refreshPendingCount();
    } finally {
      flushingRef.current = false;
      setFlushing(false);
    }
  }, [tripId, queryClient, refreshPendingCount]);

  useEffect(() => {
    const runInitial = async () => {
      await refreshPendingCount();
      await flush();
    };
    runInitial();

    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') flush();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const enqueue = useCallback(
    async (action: QueuedTripAction) => {
      await enqueueTripAction(action);
      await refreshPendingCount();
      flush();
    },
    [refreshPendingCount, flush],
  );

  return { pendingCount, flushing, flushNow: flush, enqueue };
}
