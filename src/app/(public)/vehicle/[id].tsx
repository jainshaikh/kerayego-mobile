import { useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { useVehicleDetail } from '../../../features/listings/queries';
import { SaveButton } from '../../../features/saved-vehicles/components/SaveButton';
import { InquiryFormSheet } from '../../../features/booking-requests/components/InquiryFormSheet';
import { VehicleGallery } from '../../../features/listings/components/VehicleGallery';
import { RatingSummaryBadge } from '../../../components/reviews/RatingSummaryBadge';
import { ReviewsList } from '../../../components/reviews/ReviewsList';
import { AppButton, AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState } from '../../../components/ui';
import { useAuth } from '../../../auth/auth-context';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { useTheme } from '../../../theme';
import { formatPrice, titleCase } from '../../../utils/format';
import { getAvailableDurations, getUnitPrice } from '../../../utils/rentalDuration';
import { RentalDurationType } from '../../../types/enums';

// Route param is named `id` to match the reference folder structure, but the
// backend looks vehicles up by slug (GET /listings/:slug) — not a database id.
export default function VehicleDetailScreen() {
  const { id: slug } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing } = useTheme();
  const { isAuthenticated } = useAuth();
  const [inquiryVisible, setInquiryVisible] = useState(false);

  const { data: vehicle, isLoading, isError, refetch } = useVehicleDetail(slug);
  const queryClient = useQueryClient();
  // Reviews and rating badges on this screen are their own queries, owned by
  // child components — invalidating ['reviews'] refetches the mounted ones.
  const refresh = usePullToRefresh(() =>
    Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['reviews'] })]),
  );

  if (isLoading) return <LoadingState label="Loading vehicle..." />;
  if (isError || !vehicle) {
    return <ErrorState message="This listing may have been removed." onRetry={refetch} />;
  }

  const otherDurations = getAvailableDurations(vehicle).filter((d) => d.type !== RentalDurationType.DAY);

  const handleInquire = () => {
    if (!isAuthenticated) {
      router.push({ pathname: '/login', params: { returnTo: `/vehicle/${slug}` } });
      return;
    }
    setInquiryVisible(true);
  };

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: vehicle.title }} />
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<AppRefreshControl {...refresh} />}>
        <VehicleGallery images={vehicle.images} title={vehicle.title} />

        <View style={{ padding: spacing.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <AppText variant="title" style={{ flex: 1, marginRight: spacing.md }}>
              {vehicle.title}
            </AppText>
            <SaveButton vehicleId={vehicle.id} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, gap: spacing.sm }}>
            <AppText muted style={{ textTransform: 'capitalize' }}>
              {titleCase(vehicle.make)} {titleCase(vehicle.model)} · {vehicle.year}
            </AppText>
            <RatingSummaryBadge subjectType="VEHICLE" subjectId={vehicle.id} size="sm" />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.md }}>
            <AppText variant="title" color={colors.primary}>
              {formatPrice(vehicle.pricePerDay)}
            </AppText>
            <AppText muted> / day</AppText>
          </View>

          {otherDurations.length > 0 ? (
            <View style={{ marginTop: spacing.sm }}>
              {otherDurations.map((option) => (
                <View
                  key={option.type}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}
                >
                  <AppText muted variant="caption">
                    {option.label}
                  </AppText>
                  <AppText muted variant="caption">
                    {formatPrice(getUnitPrice(vehicle, option.type))}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.sm }}>
              Specifications
            </AppText>
            <SpecRow label="Transmission" value={titleCase(vehicle.transmission)} />
            <SpecRow label="Fuel type" value={titleCase(vehicle.fuelType)} />
            <SpecRow label="Seating capacity" value={`${vehicle.seatingCapacity} seats`} />
            {vehicle.engineType ? <SpecRow label="Engine" value={vehicle.engineType} /> : null}
            {vehicle.locationText ? <SpecRow label="Location" value={vehicle.locationText} /> : null}
          </AppCard>

          {vehicle.features.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <AppText variant="label" style={{ marginBottom: spacing.sm }}>
                Features
              </AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {vehicle.features.map((feature) => (
                  <View
                    key={feature.id}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderRadius: 999,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                    }}
                  >
                    <AppText variant="caption">{feature.value ? `${feature.name}: ${feature.value}` : feature.name}</AppText>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {(vehicle.availabilityNotes || vehicle.pricingNotes || vehicle.specialConditions) ? (
            <AppCard style={{ marginTop: spacing.lg }}>
              {vehicle.availabilityNotes ? <NoteRow label="Availability" value={vehicle.availabilityNotes} /> : null}
              {vehicle.pricingNotes ? <NoteRow label="Pricing notes" value={vehicle.pricingNotes} /> : null}
              {vehicle.specialConditions ? <NoteRow label="Special conditions" value={vehicle.specialConditions} /> : null}
            </AppCard>
          ) : null}

          <Pressable onPress={() => router.push(`/provider/${vehicle.providerProfile.slug}`)}>
            <AppCard style={{ marginTop: spacing.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <AppText variant="label">{vehicle.providerProfile.businessName}</AppText>
                <RatingSummaryBadge subjectType="PROVIDER" subjectId={vehicle.providerProfile.id} size="sm" />
              </View>
              {vehicle.showroom ? (
                <AppText muted variant="caption" style={{ marginTop: 2, textTransform: 'capitalize' }}>
                  {vehicle.showroom.city}
                  {vehicle.showroom.area ? `, ${vehicle.showroom.area}` : ''}
                </AppText>
              ) : null}
              <AppText color={colors.primary} variant="caption" style={{ marginTop: spacing.xs }}>
                View provider profile →
              </AppText>
            </AppCard>
          </Pressable>

          <AppCard style={{ marginTop: spacing.lg }}>
            <ReviewsList subjectType="VEHICLE" subjectId={vehicle.id} title="Vehicle reviews" />
          </AppCard>
        </View>
      </ScrollView>

      <View style={{ flexDirection: 'row', padding: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
        {vehicle.showroom?.whatsappNumber ? (
          <AppButton
            title="WhatsApp"
            variant="secondary"
            fullWidth={false}
            onPress={() => {
              // wa.me requires digits only — no leading '+', spaces, or dashes.
              const number = vehicle.showroom!.whatsappNumber!.replace(/\D/g, '');
              Linking.openURL(`https://wa.me/${number}`).catch(() => {});
            }}
          />
        ) : null}
        <View style={{ flex: 1 }}>
          <AppButton title="Send inquiry" onPress={handleInquire} />
        </View>
      </View>

      <InquiryFormSheet
        visible={inquiryVisible}
        onClose={() => setInquiryVisible(false)}
        vehicleId={vehicle.id}
        vehicleTitle={vehicle.title}
        vehiclePricing={vehicle}
      />
    </AppScreen>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
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

function NoteRow({ label, value }: { label: string; value: string }) {
  const { spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <AppText variant="label">{label}</AppText>
      <AppText muted variant="caption">
        {value}
      </AppText>
    </View>
  );
}
