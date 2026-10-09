import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type * as Location from 'expo-location';
import { useQueryClient } from '@tanstack/react-query';

import { useRecordTripEvent } from '../../trips/queries';
import { useUpdateTripInquiryStatus } from '../queries';
import { runTripAction, type OfflineTripQueue } from '../../trips/offlineSync';
import { deriveTripActionOverlay } from '../../trips/tripActionOverlay';
import { normalizeApiError } from '../../../api/errors';
import type { RecordTripEventPayload } from '../../../api/trips.api';
import { TripEventType, TripInquiryStatus } from '../../../types/enums';

type RiderEventType = typeof TripEventType.ARRIVED | typeof TripEventType.DROPOFF;

// The two rider actions that can't be undone, each confirmed in an AppSheet
// first (see RiderConfirmSheet).
export type RiderConfirmKind = 'cancel' | 'dropoff';

interface UseRiderTripActionsParams {
  inquiryId: string;
  tripId: string;
  // The ride lock (see isRideLocked) — a drop-off can only be confirmed
  // while it holds; the sheet goes away if the ride ends for this rider
  // meanwhile (e.g. the driver marks them a no-show).
  rideLive: boolean;
  offlineQueue: OfflineTripQueue;
  position: Location.LocationObject | null;
  refetch: () => Promise<unknown>;
}

export interface RiderTripActions {
  // An "I reached the stop" failure, shown on the Stops tab next to it.
  actionError: string | null;
  actioningType: RiderEventType | null;
  riderConfirmedAtPickup: boolean;
  // The rider's own DROPOFF while it's still queued (or just applied and not
  // yet refetched) — stands in for inquiry.droppedOffAt until the server's arrives.
  optimisticDroppedOffAt: string | null;
  updateStatusPending: boolean;
  handleArrived: () => Promise<void>;
  // The open confirmation sheet, if any. Kept (closed) after it's dismissed
  // so the sheet's copy doesn't blank out while it slides away.
  confirmKind: RiderConfirmKind | null;
  confirmOpen: boolean;
  // A refusal of the confirmed action — stays in the sheet.
  confirmError: string | null;
  openCancelConfirm: () => void;
  openDropoffConfirm: () => void;
  closeConfirm: () => void;
  confirmCancel: () => Promise<void>;
  confirmDropoff: () => Promise<void>;
}

/**
 * Owns the rider's own day-of-trip actions for trip-request/[id].tsx:
 * cancelling the seat request, and self-reporting ARRIVED/DROPOFF. Cancel and
 * DROPOFF go through a confirmation sheet first. On a network error, an event
 * is queued via `offlineQueue` instead of failing outright — see runTripAction
 * (features/trips/offlineSync.ts), shared with the driver cockpit's analogous
 * actions hook.
 */
export function useRiderTripActions({
  inquiryId,
  tripId,
  rideLive,
  offlineQueue,
  position,
  refetch,
}: UseRiderTripActionsParams): RiderTripActions {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateTripInquiryStatus();
  const recordEvent = useRecordTripEvent(tripId);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actioningType, setActioningType] = useState<RiderEventType | null>(null);
  // Guards against a double tap landing before the re-render that disables
  // the button.
  const inFlightRef = useRef(false);
  // One drop-off decision = one event id, reused by every retry from the same
  // sheet, so a retry after a lost response is a replay the backend answers
  // with the stored event rather than a second drop-off.
  const [confirm, setConfirm] = useState<{ kind: RiderConfirmKind; open: boolean; eventId: string } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Derived from this rider's own ARRIVED/DROPOFF taps still in the offline
  // queue (so they survive an app restart until synced) or applied this
  // session — see deriveTripActionOverlay. A discarded action drops out, so
  // its effect rolls back on its own.
  const overlay = deriveTripActionOverlay([...offlineQueue.appliedItems, ...offlineQueue.pendingItems]);
  // Whether the RIDER has self-confirmed being at their pickup point.
  // DELIBERATELY separate from, and never written back into, the real
  // inquiry.pickupConfirmedAt field — only the DRIVER's own Pickup tap sets
  // that (a rider's self-report never overwrites the driver-authoritative
  // pickup record). Purely presentational: it only splits the pre-pickup
  // phase (see deriveRiderRidePhase), never the real geofence-gated action
  // buttons' enablement. Once its ARRIVED has synced it lasts for the
  // session only — the server keeps no rider-arrival field to restore it from.
  const riderConfirmedAtPickup = overlay.arrivedInquiryIds.has(inquiryId);
  const optimisticDroppedOffAt = overlay.riderEvents[inquiryId]?.droppedOffAt ?? null;

  const openConfirm = (kind: RiderConfirmKind) => {
    setConfirmError(null);
    setConfirm({ kind, open: true, eventId: Crypto.randomUUID() });
  };

  const closeConfirm = () => {
    setConfirm((prev) => (prev ? { ...prev, open: false } : prev));
    setConfirmError(null);
  };

  const confirmCancel = async () => {
    if (!confirm?.open || confirm.kind !== 'cancel' || inFlightRef.current) return;
    inFlightRef.current = true;
    setConfirmError(null);
    try {
      // useUpdateTripInquiryStatus refreshes the request and the app-wide
      // ride lock itself (a cancelled seat releases it).
      await updateStatus.mutateAsync({ id: inquiryId, data: { newStatus: TripInquiryStatus.CANCELLED } });
      closeConfirm();
    } catch (error) {
      setConfirmError(normalizeApiError(error).message);
    }
    inFlightRef.current = false;
  };

  const recordRiderEvent = async (
    type: RiderEventType,
    eventId: string,
    setError: (message: string | null) => void,
    onDone?: () => void,
  ) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setActioningType(type);
    const occurredAt = new Date().toISOString();
    const coords = position?.coords ?? null;
    const eventPayload: RecordTripEventPayload = {
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

    // .finally() rather than a try/finally block: React Compiler can't
    // compile a `try` without a `catch`, and would skip this whole hook.
    await runTripAction(
      // A 409 means the screen is out of date — most often the driver just
      // marked this rider as a no-show — so refetch alongside the message.
      () =>
        recordEvent.mutateAsync(eventPayload).catch((error: unknown) => {
          if (normalizeApiError(error).kind === 'conflict') void refetch();
          throw error;
        }),
      offlineQueue,
      () => ({ id: eventId, kind: 'event', tripId, createdAt: occurredAt, payload: eventPayload }),
      setError,
      {
        onSuccess: async () => {
          onDone?.();
          // A drop-off ends this rider's ride: the server stops returning
          // it as their active ride, so the app-wide lock can let go now
          // instead of on its next 20 s poll.
          if (type === TripEventType.DROPOFF) queryClient.invalidateQueries({ queryKey: ['myActiveRide'] });
          await refetch();
        },
        onQueued: onDone,
      },
    ).finally(() => {
      inFlightRef.current = false;
      setActioningType(null);
    });
  };

  const handleArrived = () => recordRiderEvent(TripEventType.ARRIVED, Crypto.randomUUID(), setActionError);

  const confirmOpen = !!confirm?.open && (confirm.kind !== 'dropoff' || rideLive);

  const confirmDropoff = async () => {
    if (!confirmOpen || confirm?.kind !== 'dropoff') return;
    await recordRiderEvent(TripEventType.DROPOFF, confirm.eventId, setConfirmError, closeConfirm);
  };

  return {
    actionError,
    actioningType,
    riderConfirmedAtPickup,
    optimisticDroppedOffAt,
    updateStatusPending: updateStatus.isPending,
    handleArrived,
    confirmKind: confirm?.kind ?? null,
    confirmOpen,
    confirmError,
    openCancelConfirm: () => openConfirm('cancel'),
    openDropoffConfirm: () => openConfirm('dropoff'),
    closeConfirm,
    confirmCancel,
    confirmDropoff,
  };
}
