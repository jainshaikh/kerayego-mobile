import { Linking, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';

import { AppButton, AppCard, AppScreen, AppText, Row, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { PickupSource, TripEventType, TripInquiryStatus, TripStatus, tripInquiryStatusMeta } from '../../../types/enums';
import { formatPrice, titleCase } from '../../../utils/format';
import type { RiderTripActions } from './useRiderTripActions';
import type { RideActionAvailability } from './rideActionAvailability';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

interface RiderPreLiveViewProps {
  inquiry: TripInquiry;
  availableActions: TripInquiryStatus[];
  riderActions: RiderTripActions;
  rideActionAvailability: RideActionAvailability;
}

// The rider's view of a seat request before the trip goes live: request
// summary, driver contact once accepted, day-of status once the trip
// starts, and geofence-gated arrive/complete actions if the trip somehow
// becomes live-eligible without the tripLive tabbed layout kicking in yet.
export function RiderPreLiveView({ inquiry, availableActions, riderActions, rideActionAvailability }: RiderPreLiveViewProps) {
  const { colors, spacing } = useTheme();
  const { showArriveButton, canArrive, arriveDisabledReason, showCompleteButton, canComplete, completeDisabledReason } =
    rideActionAvailability;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Trip request' }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <AppText variant="title" style={{ flex: 1, marginRight: spacing.md, textTransform: 'capitalize' }}>
            {titleCase(inquiry.trip.originCity)} → {titleCase(inquiry.trip.destinationCity)}
          </AppText>
          <StatusBadge label={tripInquiryStatusMeta[inquiry.status].label} tone={tripInquiryStatusMeta[inquiry.status].tone} />
        </View>
        <AppText muted style={{ marginTop: spacing.xs }}>
          {inquiry.trip.postedBy.name}
        </AppText>

        <AppCard style={{ marginTop: spacing.lg }}>
          <Row
            label="Departure"
            value={new Date(inquiry.trip.departureAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
          />
          <Row label="Seats requested" value={String(inquiry.requestedSeats)} />
          <Row label="Pickup point" value={inquiry.trip.pickupPoint} />
          {inquiry.pickupNote ? <Row label="Your note" value={inquiry.pickupNote} /> : null}
          <Row label="Price / seat" value={formatPrice(inquiry.trip.pricePerSeat)} />
        </AppCard>

        {inquiry.message ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label">Your message</AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              {inquiry.message}
            </AppText>
          </AppCard>
        ) : null}

        {inquiry.status === 'ACCEPTED' ? (
          <AppCard style={{ marginTop: spacing.lg, borderColor: colors.success }}>
            <AppText variant="label" color={colors.success}>
              Accepted!
            </AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              Contact {inquiry.trip.postedBy.name} to confirm pickup details.
            </AppText>
            <AppButton
              title="Contact via WhatsApp"
              variant="secondary"
              style={{ marginTop: spacing.md }}
              onPress={() => {
                // wa.me requires digits only — no leading '+', spaces, or dashes.
                const number = inquiry.trip.contactNumber.replace(/\D/g, '');
                Linking.openURL(`https://wa.me/${number}`).catch(() => {});
              }}
            />
          </AppCard>
        ) : null}

        {inquiry.status === 'ACCEPTED' && inquiry.trip.status !== TripStatus.ACTIVE ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.xs }}>
              Trip status
            </AppText>
            {inquiry.droppedOffAt ? (
              <AppText muted variant="caption">
                {inquiry.pickupSource === PickupSource.AUTO_ON_TRIP_END
                  ? 'Trip completed.'
                  : `You were dropped off at ${formatTime(inquiry.droppedOffAt)}.`}
              </AppText>
            ) : inquiry.pickupConfirmedAt ? (
              <AppText muted variant="caption">
                You&apos;re on the trip — picked up at {formatTime(inquiry.pickupConfirmedAt)}.
              </AppText>
            ) : inquiry.trip.status === TripStatus.IN_PROGRESS ? (
              <AppText muted variant="caption">
                Your driver has started the trip.
              </AppText>
            ) : (
              <AppText muted variant="caption">
                Trip completed.
              </AppText>
            )}
          </AppCard>
        ) : null}

        {showArriveButton || showCompleteButton ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.sm }}>
              Ride actions
            </AppText>

            {showArriveButton ? (
              <View style={{ marginBottom: showCompleteButton ? spacing.md : 0 }}>
                <AppButton
                  title="I've arrived"
                  loading={riderActions.actioningType === TripEventType.ARRIVED}
                  disabled={!canArrive || riderActions.actioningType !== null}
                  onPress={() => riderActions.handleRiderEvent(TripEventType.ARRIVED)}
                />
                {!canArrive ? (
                  <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                    {arriveDisabledReason}
                  </AppText>
                ) : null}
              </View>
            ) : null}

            {showCompleteButton ? (
              <View>
                <AppButton
                  title="Complete ride"
                  variant={showArriveButton ? 'secondary' : 'primary'}
                  loading={riderActions.actioningType === TripEventType.DROPOFF}
                  disabled={!canComplete || riderActions.actioningType !== null}
                  onPress={() => riderActions.handleRiderEvent(TripEventType.DROPOFF)}
                />
                {!canComplete ? (
                  <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                    {completeDisabledReason}
                  </AppText>
                ) : null}
              </View>
            ) : null}
          </AppCard>
        ) : null}

        {inquiry.status === 'REJECTED' && inquiry.rejectionReason ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label">Note from the driver</AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              {inquiry.rejectionReason}
            </AppText>
          </AppCard>
        ) : null}

        {riderActions.actionError ? (
          <AppText color={colors.danger} style={{ marginTop: spacing.md }}>
            {riderActions.actionError}
          </AppText>
        ) : null}

        {availableActions.includes(TripInquiryStatus.CANCELLED) ? (
          <AppButton
            title={inquiry.status === 'ACCEPTED' ? 'Cancel my seat' : 'Cancel request'}
            variant="danger"
            loading={riderActions.updateStatusPending}
            onPress={riderActions.handleCancel}
            style={{ marginTop: spacing.xl }}
          />
        ) : null}
      </ScrollView>
    </AppScreen>
  );
}
