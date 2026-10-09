import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';

import { useCancelTrip, useEndTrip, useRecordTripEvent, useStartTrip } from '../queries';
import { runTripAction, type OfflineTripQueue } from '../offlineSync';
import { deriveTripActionOverlay } from '../tripActionOverlay';
import { normalizeApiError } from '../../../api/errors';
import type { ManifestRider, ManifestRouteStop, RecordTripEventPayload } from '../../../api/trips.api';
import { TripEventType } from '../../../types/enums';

export interface DriverPosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  mocked?: boolean;
}

// The rider the "Didn't show" confirmation sheet is open for.
export interface NoShowTarget {
  riderId: string;
  riderName: string;
  stopLabel: string | null;
}

export interface DriverTripActions {
  actionError: string | null;
  startConfirming: boolean;
  setStartConfirming: (value: boolean) => void;
  endConfirming: boolean;
  setEndConfirming: (value: boolean) => void;
  // End first tries to sync this trip's queued actions; while it does, this is true.
  endSyncing: boolean;
  // > 0 once End found that many earlier actions still unsynced after trying —
  // the End sheet then asks before ending behind them. Reset when it closes.
  endUnsyncedCount: number;
  optimisticStarted: boolean;
  optimisticEnded: boolean;
  noShowIds: Set<string>;
  arrivedStopIds: Set<string>;
  // Stops whose Reached is still waiting in the offline queue (not yet sent).
  queuedArrivalStopIds: Set<string>;
  optimisticEvents: Record<string, { pickupConfirmedAt?: string; droppedOffAt?: string }>;
  cancelTripPending: boolean;
  startTripPending: boolean;
  endTripPending: boolean;
  // Per rider / per stop, so one slow request never locks every other button.
  isRiderActionPending: (tripInquiryId: string) => boolean;
  isArrivalPending: (stopId: string) => boolean;
  handleCancel: () => Promise<void>;
  handleStart: () => Promise<void>;
  handleEnd: () => Promise<void>;
  handleRiderEvent: (tripInquiryId: string, type: typeof TripEventType.PICKUP | typeof TripEventType.DROPOFF) => Promise<void>;
  handleArrived: (stop: ManifestRouteStop, currentPosition: DriverPosition | null) => Promise<void>;
  // "Didn't show": open the confirmation sheet for a rider, then confirm or close it.
  noShowOpen: boolean;
  // The rider the sheet is (or was last) open for — kept after it closes so
  // the sheet doesn't go blank while it slides away.
  noShowTarget: NoShowTarget | null;
  noShowError: string | null;
  openNoShow: (rider: ManifestRider) => void;
  closeNoShow: () => void;
  confirmNoShow: (currentPosition: DriverPosition | null) => Promise<void>;
}

const riderKey = (tripInquiryId: string) => `rider:${tripInquiryId}`;
const stopKey = (stopId: string) => `stop:${stopId}`;

/**
 * Owns every day-of-trip mutation and its optimistic/offline-queued overlay
 * state for the driver cockpit (my-trips/[id].tsx): start/cancel/end the
 * trip, and record PICKUP/DROPOFF/NO_SHOW/ARRIVED events per rider/stop. On a
 * network error, each action is queued via `offlineQueue` instead of failing
 * outright — see runTripAction (features/trips/offlineSync.ts) — which is
 * what lets the driver keep working through low-signal stretches of a route.
 */
export function useDriverTripActions(tripId: string, offlineQueue: OfflineTripQueue): DriverTripActions {
  const cancelTrip = useCancelTrip(tripId);
  const startTrip = useStartTrip(tripId);
  const endTrip = useEndTrip(tripId);
  const recordEvent = useRecordTripEvent(tripId);

  const [actionError, setActionError] = useState<string | null>(null);
  const [startConfirming, setStartConfirming] = useState(false);
  const [endConfirming, setEndConfirmingState] = useState(false);
  const [endSyncing, setEndSyncing] = useState(false);
  const [endUnsyncedCount, setEndUnsyncedCount] = useState(0);
  // The no-show sheet's rider, plus the event id for that one decision:
  // minted when the sheet opens and resent by every retry from it, so a retry
  // after a lost response is the same no-show to the server, not a second one.
  const [noShow, setNoShow] = useState<{ target: NoShowTarget; eventId: string; open: boolean } | null>(null);
  const [noShowError, setNoShowError] = useState<string | null>(null);

  // Which rider/stop actions are in flight. The ref is the double-tap guard
  // (read synchronously in the handlers — two taps in one frame would both
  // see the same state); the state is what the buttons render from.
  const inFlight = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());

  // started/ended/picked-up/dropped-off/no-show/arrived as the driver tapped
  // them, ahead of the server: derived from the actions still in the
  // persisted queue (so a queued Start still shows the cockpit after an app
  // restart) plus those applied this session that the next refetch hasn't
  // caught up with. An action the queue discards drops out of both, rolling
  // its overlay back on its own. Real data from the server always wins.
  const overlay = deriveTripActionOverlay([...offlineQueue.appliedItems, ...offlineQueue.pendingItems]);
  const queuedArrivalStopIds = deriveTripActionOverlay(offlineQueue.pendingItems).arrivedStopIds;

  // Runs one rider's (or stop's) action unless one is already in flight for
  // it. On success runTripAction records the action as applied (its overlay)
  // before the key is released, so the button has already flipped to its
  // next action by the time it's tappable again — a double tap can't resend.
  // (.finally() rather than try/finally: the React Compiler can't compile a
  // try without a catch, and would skip this whole hook.)
  const runExclusive = (key: string, run: () => Promise<void>): Promise<void> => {
    if (inFlight.current.has(key)) return Promise.resolve();
    inFlight.current.add(key);
    setPendingKeys((prev) => new Set(prev).add(key));
    return Promise.resolve()
      .then(run)
      .finally(() => {
        inFlight.current.delete(key);
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
  };

  const setEndConfirming = (value: boolean) => {
    setEndConfirmingState(value);
    if (!value) setEndUnsyncedCount(0);
  };

  const handleCancel = async () => {
    setActionError(null);
    try {
      await cancelTrip.mutateAsync(undefined);
    } catch (error) {
      setActionError(normalizeApiError(error).message);
    }
  };

  const handleStart = () => {
    const id = Crypto.randomUUID();
    const createdAt = new Date().toISOString();
    return runTripAction(
      () => startTrip.mutateAsync(),
      offlineQueue,
      () => ({ id, kind: 'start', tripId, createdAt }),
      setActionError,
      {
        onSuccess: () => setStartConfirming(false),
        onQueued: () => setStartConfirming(false),
      },
    );
  };

  const handleEnd = async () => {
    setActionError(null);
    // Ending while actions are still queued would get each of them refused
    // once they replay ("This trip is not in progress") and let End
    // auto-resolve those riders instead — so try to sync them first. If some
    // still can't go (no signal), only end once the driver confirms: End then
    // queues behind them and everything replays in order.
    if (endUnsyncedCount === 0 && (await offlineQueue.countPending().catch(() => 0)) > 0) {
      setEndSyncing(true);
      await offlineQueue.flushNow().finally(() => setEndSyncing(false));
      const remaining = await offlineQueue.countPending().catch(() => 0);
      if (remaining > 0) {
        setEndUnsyncedCount(remaining);
        return;
      }
    }

    const id = Crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await runTripAction(
      () => endTrip.mutateAsync(),
      offlineQueue,
      () => ({ id, kind: 'end', tripId, createdAt }),
      setActionError,
      {
        onSuccess: () => setEndConfirming(false),
        onQueued: () => setEndConfirming(false),
      },
    );
  };

  // PICKUP for a rider marked as a no-show is how the driver reverses it.
  const handleRiderEvent = (tripInquiryId: string, type: typeof TripEventType.PICKUP | typeof TripEventType.DROPOFF) =>
    runExclusive(riderKey(tripInquiryId), () => {
      const eventId = Crypto.randomUUID();
      const occurredAt = new Date().toISOString();
      const payload: RecordTripEventPayload = { id: eventId, tripInquiryId, type, occurredAt };

      return runTripAction(
        () => recordEvent.mutateAsync(payload),
        offlineQueue,
        () => ({ id: eventId, kind: 'event', tripId, createdAt: occurredAt, payload }),
        setActionError,
      );
    });

  const openNoShow = (rider: ManifestRider) => {
    setNoShowError(null);
    setNoShow({
      target: { riderId: rider.id, riderName: rider.user.name, stopLabel: rider.pickupStop?.label ?? null },
      eventId: Crypto.randomUUID(),
      open: true,
    });
  };

  const closeNoShow = () => {
    setNoShow((prev) => (prev ? { ...prev, open: false } : prev));
    setNoShowError(null);
  };

  // Same path as PICKUP/DROPOFF: sent now, or queued on a network error (the
  // sheet closes either way), or refused — a 409 such as "wait about 2 more
  // minutes" stays in the sheet so the driver sees why.
  const confirmNoShow = (currentPosition: DriverPosition | null) => {
    if (!noShow?.open) return Promise.resolve();
    const { target, eventId } = noShow;
    return runExclusive(riderKey(target.riderId), () => {
      // The tap time, not when the sheet opened — the server measures the
      // five-minute wait from the arrival up to this.
      const occurredAt = new Date().toISOString();
      const payload: RecordTripEventPayload = {
        id: eventId,
        tripInquiryId: target.riderId,
        type: TripEventType.NO_SHOW,
        occurredAt,
        // Audit context only — where the driver was when they stopped waiting.
        payload: currentPosition
          ? {
              lat: currentPosition.lat,
              lng: currentPosition.lng,
              accuracyM: currentPosition.accuracy ?? undefined,
              isMockLocation: currentPosition.mocked ?? undefined,
            }
          : undefined,
      };

      return runTripAction(
        () => recordEvent.mutateAsync(payload),
        offlineQueue,
        () => ({ id: eventId, kind: 'event', tripId, createdAt: occurredAt, payload }),
        setNoShowError,
        { onSuccess: closeNoShow, onQueued: closeNoShow },
      );
    });
  };

  const handleArrived = (stop: ManifestRouteStop, currentPosition: DriverPosition | null) => {
    if (!currentPosition) return Promise.resolve();
    return runExclusive(stopKey(stop.id), () => {
      const eventId = Crypto.randomUUID();
      const occurredAt = new Date().toISOString();
      const payload: RecordTripEventPayload = {
        id: eventId,
        type: TripEventType.ARRIVED,
        occurredAt,
        payload: {
          stopId: stop.id,
          lat: currentPosition.lat,
          lng: currentPosition.lng,
          accuracyM: currentPosition.accuracy ?? undefined,
          isMockLocation: currentPosition.mocked ?? undefined,
        },
      };

      return runTripAction(
        () => recordEvent.mutateAsync(payload),
        offlineQueue,
        () => ({ id: eventId, kind: 'event', tripId, createdAt: occurredAt, payload }),
        setActionError,
      );
    });
  };

  return {
    actionError,
    startConfirming,
    setStartConfirming,
    endConfirming,
    setEndConfirming,
    endSyncing,
    endUnsyncedCount,
    optimisticStarted: overlay.started,
    optimisticEnded: overlay.ended,
    noShowIds: overlay.noShowIds,
    arrivedStopIds: overlay.arrivedStopIds,
    queuedArrivalStopIds,
    optimisticEvents: overlay.riderEvents,
    cancelTripPending: cancelTrip.isPending,
    startTripPending: startTrip.isPending,
    endTripPending: endTrip.isPending,
    isRiderActionPending: (tripInquiryId) => pendingKeys.has(riderKey(tripInquiryId)),
    isArrivalPending: (stopId) => pendingKeys.has(stopKey(stopId)),
    handleCancel,
    handleStart,
    handleEnd,
    handleRiderEvent,
    handleArrived,
    noShowOpen: !!noShow?.open,
    noShowTarget: noShow?.target ?? null,
    noShowError,
    openNoShow,
    closeNoShow,
    confirmNoShow,
  };
}
