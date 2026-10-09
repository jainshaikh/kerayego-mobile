import type { ReactElement } from 'react';
import { ScrollView, View, type RefreshControlProps } from 'react-native';

import { AppButton, AppCard, AppText, Row, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { TripInquiryStatus } from '../../../types/enums';
import { titleCase } from '../../../utils/format';
import { formatTripDateTime, tripTimeZoneSuffix } from '../../../utils/tripDateTime';
import { ChatModalSheet } from '../../liveRide/components/ChatModalSheet';
import type { ServerClock } from '../../trips/driverCockpit/noShow';
import type { OfflineTripQueue } from '../../trips/offlineSync';
import { OfflineQueueNotice } from '../../trips/components/OfflineQueueNotice';
import type { RiderTripActions } from './useRiderTripActions';
import { pendingRequestTripNote, rejectionReasonHeading, seatStageBadge, type RiderSeatStage } from './riderTripState';
import { ownDropoffPoint, ownPickupPoint, seatFare, tripCurrency, vehicleDisplayName } from './tripDisplay';
import { PreTripConfirmationCard } from './PreTripConfirmationCard';
import { SeatOutcomeCard } from './SeatOutcomeCard';
import { RiderConfirmSheet } from './RiderConfirmSheet';

interface RiderPreLiveViewProps {
  inquiry: TripInquiry;
  // Never 'live' — that stage renders RiderLiveView instead.
  stage: RiderSeatStage;
  availableActions: TripInquiryStatus[];
  riderActions: RiderTripActions;
  offlineQueue: OfflineTripQueue;
  serverClock: ServerClock | null;
  refreshControl?: ReactElement<RefreshControlProps>;
  // The chat sheet — owned by the screen, which a chat push can open it from.
  chatOpen: boolean;
  onOpenChat: () => void;
  onCloseChat: () => void;
}

// The rider's scrolling view of their request whenever the ride isn't live
// for them: the request itself (pending, or why it was rejected, cancelled or
// expired), the pre-trip confirmation card once the seat is confirmed, and —
// after the ride — how it ended for them (dropped off, marked a no-show, or
// the trip ended / was cancelled / suspended). No ride actions live here:
// arriving and completing happen only in the live view.
export function RiderPreLiveView({
  inquiry,
  stage,
  availableActions,
  riderActions,
  offlineQueue,
  serverClock,
  refreshControl,
  chatOpen,
  onOpenChat,
  onCloseChat,
}: RiderPreLiveViewProps) {
  const { spacing } = useTheme();
  const { trip } = inquiry;
  const badge = seatStageBadge(stage, inquiry.status);
  const fare = seatFare(trip.pricePerSeat, inquiry.requestedSeats, tripCurrency(trip));
  const reasonHeading = rejectionReasonHeading(inquiry.status);
  const pendingNote = pendingRequestTripNote(inquiry.status, trip.status);

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }} refreshControl={refreshControl}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <AppText variant="title" style={{ flex: 1, marginRight: spacing.md, textTransform: 'capitalize' }}>
            {titleCase(trip.originCity)} → {titleCase(trip.destinationCity)}
          </AppText>
          <StatusBadge label={badge.label} tone={badge.tone} />
        </View>
        <AppText muted style={{ marginTop: spacing.xs }}>
          {trip.postedBy.name}
        </AppText>

        <OfflineQueueNotice queue={offlineQueue} />

        {stage === 'upcoming' ? (
          <PreTripConfirmationCard inquiry={inquiry} serverClock={serverClock} />
        ) : (
          <>
            {stage !== 'request' && stage !== 'live' ? (
              <SeatOutcomeCard stage={stage} inquiry={inquiry} onOpenChat={onOpenChat} />
            ) : null}

            {pendingNote ? (
              <AppCard style={{ marginTop: spacing.lg }}>
                <AppText muted>{pendingNote}</AppText>
              </AppCard>
            ) : null}

            <AppCard style={{ marginTop: spacing.lg }}>
              <Row
                label="Departure"
                value={`${formatTripDateTime(trip.departureAt, { dateStyle: 'medium', timeStyle: 'short' })}${tripTimeZoneSuffix()}`}
              />
              <Row label="Seats requested" value={String(inquiry.requestedSeats)} />
              <Row label="Your pickup" value={ownPickupPoint(inquiry).label} />
              <Row label="Your drop-off" value={ownDropoffPoint(inquiry).label} />
              {inquiry.pickupNote ? <Row label="Your note" value={inquiry.pickupNote} /> : null}
              <Row label="Vehicle" value={vehicleDisplayName(trip.userVehicle)} />
              {fare ? <Row label="Price / seat" value={fare.perSeat} /> : null}
              {fare && inquiry.requestedSeats > 1 ? <Row label="Total" value={fare.total} /> : null}
            </AppCard>
          </>
        )}

        {inquiry.message ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label">Your message</AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              {inquiry.message}
            </AppText>
          </AppCard>
        ) : null}

        {/* rejectionReason also carries why a request was cancelled by the
            driver's trip cancellation, or why it expired. */}
        {reasonHeading && inquiry.rejectionReason ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label">{reasonHeading}</AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              {inquiry.rejectionReason}
            </AppText>
          </AppCard>
        ) : null}

        {availableActions.includes(TripInquiryStatus.CANCELLED) ? (
          <AppButton
            title={inquiry.status === TripInquiryStatus.ACCEPTED ? 'Cancel my seat' : 'Cancel request'}
            variant="danger"
            onPress={riderActions.openCancelConfirm}
            style={{ marginTop: spacing.xl }}
          />
        ) : null}
      </ScrollView>

      <RiderConfirmSheet inquiry={inquiry} riderActions={riderActions} />

      {/* Chat — only reachable from the no-show card while the trip is still
          running (see SeatOutcomeCard), or a chat push's deep link then. */}
      <ChatModalSheet
        visible={chatOpen}
        onClose={onCloseChat}
        tripInquiryId={inquiry.id}
        riderName={trip.postedBy.name}
        pickupLabel={ownPickupPoint(inquiry).label}
        dropoffLabel={ownDropoffPoint(inquiry).label}
      />
    </>
  );
}
