import { useState } from 'react';
import * as Crypto from 'expo-crypto';

import { useCancelTrip, useEndTrip, useRecordTripEvent, useStartTrip } from '../queries';
import { runTripAction, type OfflineTripQueue } from '../offlineSync';
import { normalizeApiError } from '../../../api/errors';
import type { ManifestRouteStop, RecordTripEventPayload } from '../../../api/trips.api';
import { TripEventType } from '../../../types/enums';

export interface DriverTripActions {
  actionError: string | null;
  startConfirming: boolean;
  setStartConfirming: (value: boolean) => void;
  endConfirming: boolean;
  setEndConfirming: (value: boolean) => void;
  optimisticStarted: boolean;
  optimisticEnded: boolean;
  noShowIds: Set<string>;
  arrivedStopIds: Set<string>;
  optimisticEvents: Record<string, { pickupConfirmedAt?: string; droppedOffAt?: string }>;
  cancelTripPending: boolean;
  startTripPending: boolean;
  endTripPending: boolean;
  recordEventPending: boolean;
  handleCancel: () => Promise<void>;
  handleStart: () => Promise<void>;
  handleEnd: () => Promise<void>;
  handleRiderEvent: (tripInquiryId: string, type: typeof TripEventType.PICKUP | typeof TripEventType.DROPOFF | typeof TripEventType.NO_SHOW) => Promise<void>;
  handleArrived: (stop: ManifestRouteStop, currentPosition: { lat: number; lng: number; accuracy: number | null; mocked?: boolean } | null) => Promise<void>;
}

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
  const [endConfirming, setEndConfirming] = useState(false);
  // NO_SHOW doesn't change pickupConfirmedAt/droppedOffAt server-side (it's
  // just a logged event), so there's nothing to refetch — track it locally
  // to keep the tap visible until the next manifest fetch (e.g. after End Trip).
  const [noShowIds, setNoShowIds] = useState<Set<string>>(new Set());
  // ARRIVED doesn't change any rider/trip field the manifest refetch would
  // pick up (it's just a logged event, like NO_SHOW) — tracked locally so the
  // button reflects a just-recorded arrival until the next remount.
  const [arrivedStopIds, setArrivedStopIds] = useState<Set<string>>(new Set());
  // Applied when start/pickup/dropoff/end calls fail with a network error and
  // get queued instead — lets the driver keep working through the whole flow
  // offline (e.g. start the trip, then tap pickups along a low-signal route)
  // without waiting on a round trip that can't happen yet. Real data from the
  // server always wins once the queue syncs.
  const [optimisticStarted, setOptimisticStarted] = useState(false);
  const [optimisticEnded, setOptimisticEnded] = useState(false);
  const [optimisticEvents, setOptimisticEvents] = useState<
    Record<string, { pickupConfirmedAt?: string; droppedOffAt?: string }>
  >({});

  const handleCancel = async () => {
    setActionError(null);
    try {
      await cancelTrip.mutateAsync(undefined);
    } catch (error) {
      setActionError(normalizeApiError(error).message);
    }
  };

  const handleStart = () =>
    runTripAction(
      () => startTrip.mutateAsync(),
      offlineQueue.enqueue,
      () => ({ id: Crypto.randomUUID(), kind: 'start', tripId, queuedAt: new Date().toISOString() }),
      setActionError,
      {
        onSuccess: () => setStartConfirming(false),
        onQueued: () => {
          setOptimisticStarted(true);
          setStartConfirming(false);
        },
      },
    );

  const handleEnd = () =>
    runTripAction(
      () => endTrip.mutateAsync(),
      offlineQueue.enqueue,
      () => ({ id: Crypto.randomUUID(), kind: 'end', tripId, queuedAt: new Date().toISOString() }),
      setActionError,
      {
        onSuccess: () => setEndConfirming(false),
        onQueued: () => {
          setOptimisticEnded(true);
          setEndConfirming(false);
        },
      },
    );

  const handleRiderEvent = (
    tripInquiryId: string,
    type: typeof TripEventType.PICKUP | typeof TripEventType.DROPOFF | typeof TripEventType.NO_SHOW,
  ) => {
    const eventId = Crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const applyLocally = () => {
      if (type === TripEventType.NO_SHOW) {
        setNoShowIds((prev) => new Set(prev).add(tripInquiryId));
      } else {
        setOptimisticEvents((prev) => ({
          ...prev,
          [tripInquiryId]: {
            ...prev[tripInquiryId],
            ...(type === TripEventType.PICKUP ? { pickupConfirmedAt: occurredAt } : { droppedOffAt: occurredAt }),
          },
        }));
      }
    };

    return runTripAction(
      () => recordEvent.mutateAsync({ id: eventId, tripInquiryId, type, occurredAt }),
      offlineQueue.enqueue,
      () => ({
        id: eventId,
        kind: 'event',
        tripId,
        queuedAt: occurredAt,
        payload: { id: eventId, tripInquiryId, type, occurredAt },
      }),
      setActionError,
      {
        // Only NO_SHOW needs a local mirror on the SUCCESS path too — PICKUP/
        // DROPOFF are already reflected by the manifest refetch runTripAction's
        // caller triggers via recordEvent's own onSuccess invalidation.
        onSuccess: () => {
          if (type === TripEventType.NO_SHOW) setNoShowIds((prev) => new Set(prev).add(tripInquiryId));
        },
        onQueued: applyLocally,
      },
    );
  };

  const handleArrived = async (
    stop: ManifestRouteStop,
    currentPosition: { lat: number; lng: number; accuracy: number | null; mocked?: boolean } | null,
  ) => {
    if (!currentPosition) return;
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

    await runTripAction(
      () => recordEvent.mutateAsync(payload),
      offlineQueue.enqueue,
      () => ({ id: eventId, kind: 'event', tripId, queuedAt: occurredAt, payload }),
      setActionError,
      {
        onSuccess: () => setArrivedStopIds((prev) => new Set(prev).add(stop.id)),
        onQueued: () => setArrivedStopIds((prev) => new Set(prev).add(stop.id)),
      },
    );
  };

  return {
    actionError,
    startConfirming,
    setStartConfirming,
    endConfirming,
    setEndConfirming,
    optimisticStarted,
    optimisticEnded,
    noShowIds,
    arrivedStopIds,
    optimisticEvents,
    cancelTripPending: cancelTrip.isPending,
    startTripPending: startTrip.isPending,
    endTripPending: endTrip.isPending,
    recordEventPending: recordEvent.isPending,
    handleCancel,
    handleStart,
    handleEnd,
    handleRiderEvent,
    handleArrived,
  };
}
