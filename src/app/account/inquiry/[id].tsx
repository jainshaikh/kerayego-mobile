import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useBookingRequest, useUpdateBookingStatus } from '../../../features/booking-requests/queries';
import { RentalLiveDriverCard } from '../../../features/booking-requests/components/RentalLiveDriverCard';
import { CustomerLocationSharingCard } from '../../../features/liveRide/components/CustomerLocationSharingCard';
import { AppButton, AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState, StatusBadge } from '../../../components/ui';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { useTheme } from '../../../theme';
import { bookingStatusDisplay, userBookingActions, BookingRequestStatus } from '../../../types/enums';
import { formatDate, formatPrice } from '../../../utils/format';
import { normalizeApiError } from '../../../api/errors';

export default function MyInquiryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing } = useTheme();
  const { data: booking, isLoading, isError, refetch } = useBookingRequest(id);
  const updateStatus = useUpdateBookingStatus(id as string);
  const [actionError, setActionError] = useState<string | null>(null);
  const refresh = usePullToRefresh(refetch);

  if (isLoading) return <LoadingState label="Loading inquiry..." />;
  if (isError || !booking) return <ErrorState message="Couldn't load this inquiry." onRetry={refetch} />;

  const availableActions = userBookingActions(booking.status);

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

        {/* The assigned driver live on a map, only while the rental runs. */}
        {booking.status === BookingRequestStatus.IN_PROGRESS ? <RentalLiveDriverCard bookingId={booking.id} /> : null}

        {/* Only while the backend says this booking's sharing window is open
            (an hour before pickup until the driver picks the customer up). */}
        <CustomerLocationSharingCard target={{ kind: 'BOOKING', id: booking.id }} />

        <AppCard style={{ marginTop: spacing.lg }}>
          <Row label="From" value={formatDate(booking.requestedFromDate)} />
          <Row label="To" value={formatDate(booking.requestedToDate)} />
          {booking.pickupLocation ? <Row label="Pickup" value={booking.pickupLocation} /> : null}
          <Row label="Vehicle rate" value={`${formatPrice(booking.vehicle.pricePerDay)}/day`} />
        </AppCard>

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
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
      <AppText muted variant="caption">
        {label}
      </AppText>
      <AppText variant="caption">{value}</AppText>
    </View>
  );
}
