import { useState, type ReactElement } from 'react';
import { ScrollView, View, type RefreshControlProps } from 'react-native';
import { Image } from 'expo-image';

import { AppButton, AppCard, AppInput, AppText, FormScrollView, Row, StatusBadge } from '../../../components/ui';
import { RatingSummaryBadge } from '../../../components/reviews/RatingSummaryBadge';
import { useTheme } from '../../../theme';
import type { TripDetail } from '../../../types/api.types';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import type { useUpdateTripInquiryStatus } from '../../trip-inquiries/queries';
import {
  openSeatRequestCount,
  TripInquiryStatus,
  TripStatus,
  tripInquiryPosterActions,
  tripInquiryStatusMeta,
  tripPosterActions,
  tripStatusMeta,
} from '../../../types/enums';
import { normalizeApiError } from '../../../api/errors';
import { formatDate, formatPrice } from '../../../utils/format';
import type { DriverTripActions } from './useDriverTripActions';
import { tripVehicle } from '../tripVehicle';
import type { OfflineTripQueue } from '../offlineSync';
import { OfflineQueueNotice } from '../components/OfflineQueueNotice';

interface DriverPostedTripViewProps {
  trip: TripDetail;
  effectiveInProgress: boolean;
  effectiveCompleted: boolean;
  inquiries: TripInquiry[];
  inquiriesLoading: boolean;
  updateInquiryStatus: ReturnType<typeof useUpdateTripInquiryStatus>;
  driverActions: DriverTripActions;
  offlineQueue: OfflineTripQueue;
  refreshControl?: ReactElement<RefreshControlProps>;
}

// The driver's view of a trip before it goes live: trip summary, vehicle,
// incoming seat requests inbox (accept/decline a request, cancel a booked
// seat — A49), and the Start/Cancel actions. Cancel trip stays disabled while
// any request is still pending or booked: the backend refuses it then. Rendered by my-trips/[id].tsx while the trip hasn't started (or
// after it has been rejected/cancelled).
export function DriverPostedTripView({
  trip,
  effectiveInProgress,
  effectiveCompleted,
  inquiries,
  inquiriesLoading,
  updateInquiryStatus,
  driverActions,
  offlineQueue,
  refreshControl,
}: DriverPostedTripViewProps) {
  const { colors, spacing } = useTheme();
  // The request whose decline / seat-cancel confirmation is open, with its
  // optional note for the rider (stored as the reason on either).
  const [confirming, setConfirming] = useState<{ id: string; action: 'decline' | 'cancelSeat' } | null>(null);
  const [note, setNote] = useState('');
  // The backend's message for the last failed action, shown under that request.
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // A return trip runs in a business's fleet car — see tripVehicle.
  const vehicle = tripVehicle(trip);
  const openRequests = openSeatRequestCount(inquiries);
  const isRowPending = (id: string) => updateInquiryStatus.isPending && updateInquiryStatus.variables?.id === id;

  const openConfirm = (id: string, action: 'decline' | 'cancelSeat') => {
    setNote('');
    setRowError(null);
    setConfirming({ id, action });
  };

  const setStatus = async (id: string, newStatus: TripInquiryStatus, withNote?: string) => {
    setRowError(null);
    try {
      await updateInquiryStatus.mutateAsync({ id, data: { newStatus, note: withNote?.trim() || undefined } });
      setConfirming(null);
    } catch (error) {
      setRowError({ id, message: normalizeApiError(error).message });
    }
  };

  const statusMeta = tripStatusMeta[trip.status];
  const posterActions = effectiveCompleted ? [] : effectiveInProgress ? ['end' as const] : tripPosterActions(trip.status);

  return (
    // A form scroll view for the decline-note input in the requests inbox.
    <FormScrollView contentContainerStyle={{ padding: spacing.lg }} refreshControl={refreshControl}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <AppText variant="title" style={{ textTransform: 'capitalize', flex: 1, marginRight: spacing.md }}>
          {trip.originCity} → {trip.destinationCity}
        </AppText>
        <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
      </View>

      {/* Also where a discarded queued Start is reported — the trip has
          rolled back to this pre-start view by then. */}
      <OfflineQueueNotice queue={offlineQueue} />

      {trip.rejectionReason ? (
        <AppCard style={{ marginTop: spacing.lg }}>
          <AppText variant="label" color={colors.danger}>
            Rejection reason
          </AppText>
          <AppText muted style={{ marginTop: spacing.xs }}>
            {trip.rejectionReason}
          </AppText>
        </AppCard>
      ) : null}
      {trip.cancelReason ? (
        <AppCard style={{ marginTop: spacing.lg }}>
          <AppText variant="label">Cancellation reason</AppText>
          <AppText muted style={{ marginTop: spacing.xs }}>
            {trip.cancelReason}
          </AppText>
        </AppCard>
      ) : null}

      <AppCard style={{ marginTop: spacing.lg }}>
        <Row label="Departure" value={formatDate(trip.departureAt)} />
        <Row label="Pickup point" value={trip.pickupPoint} />
        {trip.dropoffPoint ? <Row label="Drop-off point" value={trip.dropoffPoint} /> : null}
        <Row label="Available seats" value={String(trip.availableSeats)} />
        <Row label="Price / seat" value={formatPrice(trip.pricePerSeat)} />
        <Row label="Contact number" value={trip.contactNumber} />
      </AppCard>

      <AppCard style={{ marginTop: spacing.lg }}>
        <AppText variant="label" style={{ marginBottom: spacing.sm }}>
          Vehicle
        </AppText>
        {vehicle && vehicle.images.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {vehicle.images.map((image) => (
                <View
                  key={image.id ?? image.url}
                  style={{ width: 112, height: 80, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}
                >
                  <Image source={{ uri: image.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}
        {vehicle ? <Row label="Vehicle" value={vehicle.name} /> : null}
        {vehicle?.plateNumber ? <Row label="Plate" value={vehicle.plateNumber} /> : null}
        {trip.providerProfile ? <Row label="Business" value={trip.providerProfile.businessName} /> : null}
      </AppCard>

      {trip.notes ? (
        <AppCard style={{ marginTop: spacing.lg }}>
          <AppText variant="label">Notes</AppText>
          <AppText muted style={{ marginTop: spacing.xs }}>
            {trip.notes}
          </AppText>
        </AppCard>
      ) : null}

      {trip.status === TripStatus.ACTIVE && !effectiveInProgress ? (
        <AppCard style={{ marginTop: spacing.lg }}>
          <AppText variant="label" style={{ marginBottom: spacing.sm }}>
            Incoming requests
          </AppText>
          {inquiriesLoading ? (
            <AppText muted variant="caption">
              Loading…
            </AppText>
          ) : !inquiries.length ? (
            <AppText muted variant="caption">
              No requests yet — riders who ask for a seat will show up here.
            </AppText>
          ) : (
            inquiries.map((inquiry) => (
              <View
                key={inquiry.id}
                style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <AppText variant="caption" style={{ flex: 1, marginRight: spacing.sm }}>
                    {inquiry.user.name} · {inquiry.requestedSeats} seat{inquiry.requestedSeats !== 1 ? 's' : ''}
                  </AppText>
                  <StatusBadge
                    label={tripInquiryStatusMeta[inquiry.status].label}
                    tone={tripInquiryStatusMeta[inquiry.status].tone}
                  />
                </View>
                <RatingSummaryBadge subjectType="USER" subjectId={inquiry.user.id} size="sm" />
                {inquiry.message ? (
                  <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                    &ldquo;{inquiry.message}&rdquo;
                  </AppText>
                ) : null}

                <SeatRequestActions
                  inquiry={inquiry}
                  actions={tripInquiryPosterActions(inquiry.status, trip.status)}
                  confirmingAction={confirming?.id === inquiry.id ? confirming.action : null}
                  note={note}
                  onChangeNote={setNote}
                  error={rowError?.id === inquiry.id ? rowError.message : null}
                  busy={updateInquiryStatus.isPending}
                  pending={isRowPending(inquiry.id)}
                  onAccept={() => setStatus(inquiry.id, TripInquiryStatus.ACCEPTED)}
                  onOpenConfirm={(action) => openConfirm(inquiry.id, action)}
                  onCloseConfirm={() => setConfirming(null)}
                  onConfirm={(action) =>
                    setStatus(
                      inquiry.id,
                      action === 'cancelSeat' ? TripInquiryStatus.CANCELLED : TripInquiryStatus.REJECTED,
                      note,
                    )
                  }
                />
              </View>
            ))
          )}
        </AppCard>
      ) : null}

      {driverActions.actionError ? (
        <AppText color={colors.danger} style={{ marginTop: spacing.md }}>
          {driverActions.actionError}
        </AppText>
      ) : null}

      {posterActions.includes('start') ? (
        driverActions.startConfirming ? (
          <AppCard style={{ marginTop: spacing.xl }}>
            <AppText variant="label">Start this trip?</AppText>
            <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
              This locks in your currently accepted riders as the manifest and removes the trip from search.
            </AppText>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <AppButton title="Not yet" variant="secondary" onPress={() => driverActions.setStartConfirming(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton title="Start trip" loading={driverActions.startTripPending} onPress={driverActions.handleStart} />
              </View>
            </View>
          </AppCard>
        ) : (
          <AppButton title="Start trip" onPress={() => driverActions.setStartConfirming(true)} style={{ marginTop: spacing.xl }} />
        )
      ) : null}

      {posterActions.includes('cancel') ? (
        <>
          <AppButton
            title="Cancel trip"
            variant="danger"
            // A49: the backend refuses while any seat request is pending or
            // booked — the driver declines/cancels each one first.
            disabled={inquiriesLoading || openRequests > 0}
            loading={driverActions.cancelTripPending}
            onPress={driverActions.handleCancel}
            style={{ marginTop: spacing.md }}
          />
          {openRequests > 0 ? (
            <AppText muted variant="caption" style={{ marginTop: spacing.xs, textAlign: 'center' }}>
              Cancel or decline each seat first ({openRequests} still open).
            </AppText>
          ) : null}
        </>
      ) : null}
    </FormScrollView>
  );
}

type ConfirmAction = 'decline' | 'cancelSeat';

interface SeatRequestActionsProps {
  inquiry: TripInquiry;
  // tripInquiryPosterActions(inquiry.status, trip.status)
  actions: TripInquiryStatus[];
  confirmingAction: ConfirmAction | null;
  note: string;
  onChangeNote: (text: string) => void;
  // The backend's message for this request's last failed action.
  error: string | null;
  // Any request's status change is in flight / this one's is.
  busy: boolean;
  pending: boolean;
  onAccept: () => void;
  onOpenConfirm: (action: ConfirmAction) => void;
  onCloseConfirm: () => void;
  onConfirm: (action: ConfirmAction) => void;
}

// One request's driver actions: Accept/Decline while PENDING, Cancel seat
// once ACCEPTED, each destructive one behind an inline confirmation with an
// optional note the rider sees (UpdateTripInquiryStatusDto.note).
function SeatRequestActions({
  inquiry,
  actions,
  confirmingAction,
  note,
  onChangeNote,
  error,
  busy,
  pending,
  onAccept,
  onOpenConfirm,
  onCloseConfirm,
  onConfirm,
}: SeatRequestActionsProps) {
  const { colors, spacing } = useTheme();
  const canRespond = actions.includes(TripInquiryStatus.ACCEPTED);
  const canCancelSeat = actions.includes(TripInquiryStatus.CANCELLED);
  const seats = inquiry.requestedSeats;

  return (
    <>
      {canRespond && !confirmingAction ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton title="Accept" loading={pending} disabled={busy} onPress={onAccept} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton title="Decline" variant="secondary" disabled={busy} onPress={() => onOpenConfirm('decline')} />
          </View>
        </View>
      ) : null}

      {canCancelSeat && !confirmingAction ? (
        <AppButton
          title="Cancel seat"
          variant="secondary"
          disabled={busy}
          onPress={() => onOpenConfirm('cancelSeat')}
          style={{ marginTop: spacing.sm }}
        />
      ) : null}

      {confirmingAction ? (
        <View style={{ marginTop: spacing.sm }}>
          {confirmingAction === 'cancelSeat' ? (
            <AppText variant="caption" style={{ marginBottom: spacing.sm }}>
              Cancel {inquiry.user.name}&apos;s booked {seats === 1 ? 'seat' : `${seats} seats`}? They&apos;ll be
              told, and the {seats === 1 ? 'seat goes' : 'seats go'} back on sale.
            </AppText>
          ) : null}
          <AppInput
            placeholder={confirmingAction === 'cancelSeat' ? 'Reason for the rider (optional)' : 'Optional note for the rider'}
            value={note}
            onChangeText={onChangeNote}
            maxLength={500}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AppButton
                title={confirmingAction === 'cancelSeat' ? 'Keep seat' : 'Keep pending'}
                variant="secondary"
                disabled={pending}
                onPress={onCloseConfirm}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton
                title={confirmingAction === 'cancelSeat' ? 'Cancel seat' : 'Confirm decline'}
                variant="danger"
                loading={pending}
                disabled={busy && !pending}
                onPress={() => onConfirm(confirmingAction)}
              />
            </View>
          </View>
        </View>
      ) : null}

      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
          {error}
        </AppText>
      ) : null}
    </>
  );
}
