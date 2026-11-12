import { useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { useVehicleDetail } from '../../../features/listings/queries';
import { SaveButton } from '../../../features/saved-vehicles/components/SaveButton';
import { InquiryFormSheet } from '../../../features/booking-requests/components/InquiryFormSheet';
import { VehicleGallery } from '../../../features/listings/components/VehicleGallery';
import { CarRatingLine } from '../../../features/listings/components/CarRatingLine';
import { ReviewsList } from '../../../components/reviews/ReviewsList';
import { AppButton, AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState } from '../../../components/ui';
import { useAuth } from '../../../auth/auth-context';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { useTheme } from '../../../theme';
import { formatPrice, titleCase } from '../../../utils/format';
import { PRICE_TO_AGREE, packageOptions } from '../../../utils/rentalDuration';
import { RentalDurationType } from '../../../types/enums';

// Route param is named `id` to match the reference folder structure, but the
// backend looks vehicles up by slug (GET /listings/:slug) — not a database id.
export default function VehicleDetailScreen() {
  const { id: slug } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing } = useTheme();
  const { isAuthenticated } = useAuth();
  // null = closed; otherwise which request the sheet opens on (A84: "Ask for a
  // price" starts a weekly & monthly request).
  const [requestMode, setRequestMode] = useState<'hourlyDaily' | 'weeklyMonthly' | null>(null);

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

  // The hour packages under the day price (no week or month prices — A79).
  const hourPackages = packageOptions(vehicle).filter(
    (option) => option.price !== null && option.type !== RentalDurationType.DAY,
  );

  const openRequest = (mode: 'hourlyDaily' | 'weeklyMonthly') => {
    if (!isAuthenticated) {
      router.push({ pathname: '/login', params: { returnTo: `/vehicle/${slug}` } });
      return;
    }
    setRequestMode(mode);
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

          <AppText muted style={{ marginTop: spacing.xs, textTransform: 'capitalize' }}>
            {titleCase(vehicle.make)} {titleCase(vehicle.model)} · {vehicle.year}
          </AppText>

          {/* "This exact car" (A87): the request is for this car, with its own
              rating and rides across its plate. */}
          <View style={{ marginTop: spacing.sm }}>
            <CarRatingLine vehicleId={vehicle.id} carRating={vehicle.carRating} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.md }}>
            <AppText variant="title" color={colors.primary}>
              {formatPrice(vehicle.pricePerDay)}
            </AppText>
            <AppText muted> / day</AppText>
          </View>

          {hourPackages.length > 0 || vehicle.offersWeeklyMonthly ? (
            <View style={{ marginTop: spacing.sm }}>
              {hourPackages.map((option) => (
                <View
                  key={option.type}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}
                >
                  <AppText muted variant="caption">
                    {option.label}
                  </AppText>
                  <AppText muted variant="caption">
                    {formatPrice(option.price)}
                  </AppText>
                </View>
              ))}
              {vehicle.offersWeeklyMonthly ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                  <AppText muted variant="caption">
                    Weekly & monthly · {PRICE_TO_AGREE}
                  </AppText>
                  <Pressable onPress={() => openRequest('weeklyMonthly')} accessibilityRole="button" hitSlop={8}>
                    <AppText variant="caption" color={colors.primary}>
                      Ask for a price
                    </AppText>
                  </Pressable>
                </View>
              ) : null}
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
              {/* No business rating (A18) — only the car is rated on this screen. */}
              <AppText variant="label">{vehicle.providerProfile.businessName}</AppText>
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
          <AppButton title="Request this car" onPress={() => openRequest('hourlyDaily')} />
        </View>
      </View>

      {requestMode ? (
        <InquiryFormSheet
          // A fresh form for each way in (Request / Ask for a price).
          key={requestMode}
          visible
          onClose={() => setRequestMode(null)}
          car={vehicle}
          weeklyMonthly={requestMode === 'weeklyMonthly'}
        />
      ) : null}
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
