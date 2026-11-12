import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useBookingRequest, useUpdateBookingStatus } from '../../../features/booking-requests/queries';
import { RentalLiveDriverCard } from '../../../features/booking-requests/components/RentalLiveDriverCard';
import { RentalDriverCard } from '../../../features/booking-requests/components/RentalDriverCard';
import { BookingRouteCard } from '../../../features/booking-requests/components/BookingRouteCard';
import { bookingStatusExplanation, rentalDriverCard } from '../../../features/booking-requests/bookingDisplay';
import { bookingTimeLabel, passengersLabel, tripTypeLabel } from '../../../features/booking-requests/bookingRoute';
import { CustomerLocationSharingCard } from '../../../features/liveRide/components/CustomerLocationSharingCard';
import { AppButton, AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState, StatusBadge } from '../../../components/ui';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { useTheme } from '../../../theme';
import { bookingStatusDisplay, userBookingActions, BookingRequestStatus } from '../../../types/enums';
import { formatDate, formatPrice } from '../../../utils/format';
import { PRICE_TO_AGREE, isPriceToAgree, packageLabel } from '../../../utils/rentalDuration';
import { normalizeApiError } from '../../../api/errors';
import { useRatingPrompt } from '../../../features/reviews/useRatingPrompt';
import { customerBookingPendingRating } from '../../../features/reviews/ratingPrompt';
import { RateSheet } from '../../../features/reviews/components/RateSheet';
import { RatePromptCard } from '../../../features/reviews/components/RatePromptCard';

export default function MyInquiryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing } = useTheme();
  const { data: booking, isLoading, isError, refetch } = useBookingRequest(id);
  const updateStatus = useUpdateBookingStatus(id as string);
  const [actionError, setActionError] = useState<string | null>(null);
  const refresh = usePullToRefresh(refetch);
  // Rating the car and the driver once the rental is completed (the
  // "Rental completed" push lands here): the sheet opens on its own once per
  // booking on this device, and a card stays until it's rated.
  const rentalOver = booking?.status === BookingRequestStatus.COMPLETED;
  const rating = useRatingPrompt({
    context: 'booking',
    id: booking?.id,
    rideOver: rentalOver,
    pick: (eligible) => {
      const pending = booking ? customerBookingPendingRating(eligible, booking.id) : null;
      return pending ? [pending] : [];
    },
    otherSheetOpen: false,
  });
  const showRateCard = rentalOver && rating.pendings.length > 0;

  if (isLoading) return <LoadingState label="Loading inquiry..." />;
  if (isError || !booking) return <ErrorState message="Couldn't load this inquiry." onRetry={refetch} />;

  const availableActions = userBookingActions(booking.status);
  const statusExplanation = bookingStatusExplanation(booking.status);
  const driverCard = rentalDriverCard(booking);
  const priceToAgree = isPriceToAgree(booking.durationType);
  const hasStops = (booking.stops?.length ?? 0) > 0;
  const tripType = tripTypeLabel(booking.tripType);
  const passengers = passengersLabel(booking.passengerCount);

  const handleCancel = async () => {
    setActionError(null);
    try {
      await updateStatus.mutateAsync({ newStatus: BookingRequestStatus.CANCELLED });
    } catch (error) {
      setActionError(normalizeApiError(error).message);
    }
  };

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Inquiry details' }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }} refreshControl={<AppRefreshControl {...refresh} />}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <AppText variant="title" style={{ flex: 1, marginRight: spacing.md }}>
            {booking.vehicle.title}
          </AppText>
          <StatusBadge label={bookingStatusDisplay(booking.status).label} tone={bookingStatusDisplay(booking.status).tone} />
        </View>
        <AppText muted style={{ marginTop: spacing.xs }}>
          {booking.providerProfile.businessName}
        </AppText>

        {showRateCard ? (
          <RatePromptCard
            title="Rate your rental"
            body={(rating.pendings[0]?.targets.length ?? 0) > 1 ? 'How were the car and your driver?' : 'How was the car?'}
            onRate={rating.openSheet}
            style={{ marginTop: spacing.lg }}
          />
        ) : null}

        {statusExplanation ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText muted>{statusExplanation}</AppText>
          </AppCard>
        ) : null}

        {/* The driver card (A86) once a driver is assigned. Call/WhatsApp only
            while ACCEPTED and once the backend sends their phone (the driver
            accepted the job, D14). */}
        {driverCard ? <RentalDriverCard driver={driverCard} style={{ marginTop: spacing.lg }} /> : null}

        {/* The assigned driver live on a map, only while the rental runs. */}
        {booking.status === BookingRequestStatus.IN_PROGRESS ? <RentalLiveDriverCard bookingId={booking.id} /> : null}

        {/* Only while the backend says this booking's sharing window is open
            (an hour before pickup until the driver picks the customer up). */}
        <CustomerLocationSharingCard target={{ kind: 'BOOKING', id: booking.id }} />

        <AppCard style={{ marginTop: spacing.lg }}>
          <Row label="Package" value={packageLabel(booking.durationType, booking.durationQuantity)} />
          {tripType ? <Row label="Trip" value={tripType} /> : null}
          {passengers ? <Row label="Passengers" value={passengers} /> : null}
          <Row label={priceToAgree ? 'Starts' : 'Pickup'} value={bookingTimeLabel(booking.requestedFromDate)} />
          <Row label="Ends" value={bookingTimeLabel(booking.requestedToDate)} />
          {/* An older request without stops: its free-text places. */}
          {!hasStops && booking.pickupLocation ? <Row label="Pickup place" value={booking.pickupLocation} /> : null}
          {!hasStops && booking.dropoffLocation ? <Row label="Drop-off place" value={booking.dropoffLocation} /> : null}
          {priceToAgree ? (
            <Row label="Price" value={PRICE_TO_AGREE} />
          ) : booking.totalPrice ? (
            <Row label="Total" value={formatPrice(booking.totalPrice)} />
          ) : (
            <Row label="Vehicle rate" value={`${formatPrice(booking.vehicle.pricePerDay)}/day`} />
          )}
          {priceToAgree ? (
            <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
              The business will call you to agree the price.
            </AppText>
          ) : null}
        </AppCard>

        {/* Week / month: what the business needs to quote (A85). */}
        {priceToAgree && (booking.driverHoursPerDay || booking.daysPerWeek || booking.kmPerMonth) ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            {booking.driverHoursPerDay ? <Row label="Driver's hours per day" value={`${booking.driverHoursPerDay} h`} /> : null}
            {booking.daysPerWeek ? <Row label="Days per week" value={String(booking.daysPerWeek)} /> : null}
            {booking.kmPerMonth ? <Row label="Kilometres per month" value={`About ${booking.kmPerMonth.toLocaleString()} km`} /> : null}
          </AppCard>
        ) : null}

        <BookingRouteCard booking={booking} style={{ marginTop: spacing.lg }} />

        {booking.message ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label">Your message</AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              {booking.message}
            </AppText>
          </AppCard>
        ) : null}

        {booking.statusHistory.length > 0 ? (
          <View style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.sm }}>
              Status history
            </AppText>
            {booking.statusHistory.map((entry) => (
              <View key={entry.id} style={{ marginBottom: spacing.sm }}>
                <AppText variant="caption">
                  {bookingStatusDisplay(entry.oldStatus).label} → {bookingStatusDisplay(entry.newStatus).label}
                </AppText>
                <AppText muted variant="caption">
                  {formatDate(entry.createdAt)}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        {actionError ? (
          <AppText color={colors.danger} style={{ marginTop: spacing.md }}>
            {actionError}
          </AppText>
        ) : null}

        {availableActions.includes(BookingRequestStatus.CANCELLED) ? (
          <AppButton
            title="Cancel inquiry"
            variant="danger"
            loading={updateStatus.isPending}
            onPress={handleCancel}
            style={{ marginTop: spacing.xl }}
          />
        ) : null}
      </ScrollView>
      <RateSheet
        visible={rating.sheetOpen}
        pendings={rating.pendings}
        title="Rate your rental"
        subtitle={booking.vehicle.title}
        dismissLabel="Later"
        onClose={rating.closeSheet}
      />
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.xs }}>
      <AppText muted variant="caption">
        {label}
      </AppText>
      <AppText variant="caption" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  );
}
