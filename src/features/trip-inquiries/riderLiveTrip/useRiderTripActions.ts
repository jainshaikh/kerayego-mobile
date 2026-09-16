import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import type * as Location from 'expo-location';

import { useRecordTripEvent } from '../../trips/queries';
import { useUpdateTripInquiryStatus } from '../queries';
import { runTripAction, type OfflineTripQueue } from '../../trips/offlineSync';
import { normalizeApiError } from '../../../api/errors';
import { TripEventType, TripInquiryStatus } from '../../../types/enums';

type RiderEventType = typeof TripEventType.ARRIVED | typeof TripEventType.DROPOFF;

interface UseRiderTripActionsParams {
  inquiryId: string;
  tripId: string;
  offlineQueue: OfflineTripQueue;
  position: Location.LocationObject | null;
  refetch: () => Promise<unknown>;
}

export interface RiderTripActions {
  actionError: string | null;
  actioningType: RiderEventType | null;
  riderConfirmedAtPickup: boolean;
  updateStatusPending: boolean;
  handleCancel: () => Promise<void>;
  handleRiderEvent: (type: RiderEventType) => Promise<void>;
}

/**
 * Owns the rider's own day-of-trip actions for trip-request/[id].tsx:
 * cancelling the seat request, and self-reporting ARRIVED/DROPOFF. On a
 * network error, the event is queued via `offlineQueue` instead of failing
 * outright — see runTripAction (features/trips/offlineSync.ts), shared with
 * the driver cockpit's analogous actions hook.
 */
export function useRiderTripActions({
  inquiryId,
  tripId,
  offlineQueue,
  position,
  refetch,
}: UseRiderTripActionsParams): RiderTripActions {
  const updateStatus = useUpdateTripInquiryStatus();
  const recordEvent = useRecordTripEvent(tripId);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actioningType, setActioningType] = useState<RiderEventType | null>(null);
  // Whether the RIDER has locally self-confirmed being at their pickup
  // point. DELIBERATELY separate from, and never written back into, the
  // real inquiry.pickupConfirmedAt field — only the DRIVER's own Pickup tap
  // sets that (a rider's self-report never overwrites the driver-
  // authoritative pickup record). Purely presentational: it only gates which
  // map-overlay/live-card treatment shows, never the real geofence-gated
  // action buttons' enablement. Resets on remount, same as every other
  // local-only event flag in this app.
  const [riderConfirmedAtPickup, setRiderConfirmedAtPickup] = useState(false);

  const handleCancel = async () => {
    setActionError(null);
    try {
      await updateStatus.mutateAsync({ id: inquiryId, data: { newStatus: TripInquiryStatus.CANCELLED } });
    } catch (error) {
      setActionError(normalizeApiError(error).message);
    }
  };

  const handleRiderEvent = async (type: RiderEventType) => {
    setActioningType(type);
    const eventId = Crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const coords = position?.coords ?? null;
    const eventPayload = {
      id: eventId,
      tripInquiryId: inquiryId,
      type,
      occurredAt,
      payload: {
        lat: coords?.latitude ?? null,
        lng: coords?.longitude ?? null,
        accuracyM: coords?.accuracy ?? null,
        isMockLocation: position?.mocked ?? false,
      },
    };

    try {
      await runTripAction(
        () => recordEvent.mutateAsync(eventPayload),
        offlineQueue.enqueue,
        () => ({ id: eventId, kind: 'event', tripId, queuedAt: occurredAt, payload: eventPayload }),
        setActionError,
        {
          onSuccess: async () => {
            if (type === TripEventType.ARRIVED) setRiderConfirmedAtPickup(true);
            await refetch();
          },
          onQueued: () => {
            if (type === TripEventType.ARRIVED) setRiderConfirmedAtPickup(true);
          },
        },
      );
    } finally {
      setActioningType(null);
    }
  };

  return {
    actionError,
    actioningType,
    riderConfirmedAtPickup,
    updateStatusPending: updateStatus.isPending,
    handleCancel,
    handleRiderEvent,
  };
}
