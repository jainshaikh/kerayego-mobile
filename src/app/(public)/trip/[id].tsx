import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useTrip } from '../../../features/trips/queries';
import { TripInquiryFormSheet } from '../../../features/trips/components/TripInquiryFormSheet';
import { RatingSummaryBadge } from '../../../components/reviews/RatingSummaryBadge';
import { ReviewsList } from '../../../components/reviews/ReviewsList';
import { AppButton, AppCard, AppScreen, AppText, ErrorState, LoadingState, Row } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { formatPrice, titleCase } from '../../../utils/format';

function formatDepartureDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing } = useTheme();
  const { data: trip, isLoading, isError, refetch } = useTrip(id);
  const [requestSheetVisible, setRequestSheetVisible] = useState(false);

  if (isLoading) return <LoadingState label="Loading trip..." />;
  if (isError || !trip) return <ErrorState message="This trip may no longer be available." onRetry={refetch} />;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: `${trip.originCity} → ${trip.destinationCity}` }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <AppText variant="title" style={{ textTransform: 'capitalize' }}>
          {trip.originCity} → {trip.destinationCity}
        </AppText>
        <AppText muted style={{ marginTop: spacing.xs }}>
          {formatDepartureDateTime(trip.departureAt)}
        </AppText>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.md }}>
          <AppText variant="title" color={colors.primary}>
            {formatPrice(trip.pricePerSeat)}
          </AppText>
          <AppText muted> / seat</AppText>
        </View>

        {trip.userVehicle.images.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {trip.userVehicle.images.map((image) => (
                <View
                  key={image.id}
                  style={{ width: 220, aspectRatio: 16 / 10, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}
                >
                  <Image
                    source={{ uri: image.url }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    accessibilityLabel={image.altText ?? `${trip.userVehicle.make} ${trip.userVehicle.model}`}
                  />
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}

        <AppCard style={{ marginTop: spacing.lg }}>
          <Row label="Pickup point" value={trip.pickupPoint} />
          {trip.dropoffPoint ? <Row label="Drop-off point" value={trip.dropoffPoint} /> : null}
          <Row label="Available seats" value={String(trip.availableSeats)} />
        </AppCard>

        <AppCard style={{ marginTop: spacing.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <AppText variant="label">Vehicle</AppText>
            <RatingSummaryBadge subjectType="USER_VEHICLE" subjectId={trip.userVehicle.id} size="sm" />
          </View>
          <Row
            label="Vehicle"
            value={`${titleCase(trip.userVehicle.make)} ${titleCase(trip.userVehicle.model)}${trip.userVehicle.year ? ` (${trip.userVehicle.year})` : ''}`}
          />
          {trip.userVehicle.color ? <Row label="Color" value={titleCase(trip.userVehicle.color)} /> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs }}>
            <AppText muted variant="caption">
              Posted by
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <AppText variant="caption">{trip.postedBy.name}</AppText>
              <RatingSummaryBadge subjectType="USER" subjectId={trip.postedBy.id} size="sm" />
            </View>
          </View>
        </AppCard>

        {trip.notes ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label">Notes</AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              {trip.notes}
            </AppText>
          </AppCard>
        ) : null}

        <AppCard style={{ marginTop: spacing.lg }}>
          <ReviewsList subjectType="USER" subjectId={trip.postedBy.id} title="Driver reviews" />
        </AppCard>

        {trip.availableSeats > 0 ? (
          <AppButton
            title="Request seats"
            style={{ marginTop: spacing.xl }}
            onPress={() => setRequestSheetVisible(true)}
          />
        ) : (
          <AppButton title="Full — no seats left" variant="secondary" disabled style={{ marginTop: spacing.xl }} />
        )}
        <AppButton
          title="Contact via WhatsApp"
          variant="secondary"
          style={{ marginTop: spacing.sm }}
          onPress={() => {
            // wa.me requires digits only — no leading '+', spaces, or dashes.
            const number = trip.contactNumber.replace(/\D/g, '');
            Linking.openURL(`https://wa.me/${number}`).catch(() => {});
          }}
        />
      </ScrollView>

      <TripInquiryFormSheet
        visible={requestSheetVisible}
        onClose={() => setRequestSheetVisible(false)}
        tripId={trip.id}
        routeLabel={`${titleCase(trip.originCity)} → ${titleCase(trip.destinationCity)}`}
        availableSeats={trip.availableSeats}
        stops={trip.stops}
      />
    </AppScreen>
  );
}
