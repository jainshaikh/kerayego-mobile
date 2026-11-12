import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTheme } from '../../../theme';
import { AppButton, AppCard, AppText } from '../../../components/ui';
import { SaveButton } from '../../saved-vehicles/components/SaveButton';
import { formatDistance, formatPrice, titleCase } from '../../../utils/format';
import { PRICE_TO_AGREE } from '../../../utils/rentalDuration';
import type { VehicleCard as VehicleCardData } from '../../../types/api.types';
import { CarRatingLine } from './CarRatingLine';

interface VehicleCardProps {
  vehicle: VehicleCardData;
  // The browse section it's shown in (A84): "Hourly & daily" shows the day
  // price; "Weekly & monthly" shows "Price to agree" and an "Ask for a price"
  // button (onAskForPrice) that opens the request.
  mode?: 'hourlyDaily' | 'weeklyMonthly';
  onAskForPrice?: () => void;
}

export function VehicleCard({ vehicle, mode = 'hourlyDaily', onAskForPrice }: VehicleCardProps) {
  const { colors, spacing } = useTheme();
  const cover = vehicle.images[0];
  const weeklyMonthly = mode === 'weeklyMonthly';

  return (
    <Pressable
      onPress={() => router.push(`/vehicle/${vehicle.slug}`)}
      accessibilityRole="button"
      accessibilityLabel={vehicle.title}
    >
      <AppCard style={{ padding: 0, overflow: 'hidden', marginBottom: spacing.md }}>
        <View style={{ width: '100%', aspectRatio: 16 / 10, backgroundColor: colors.surfaceAlt }}>
          {cover ? (
            <Image
              source={{ uri: cover.url }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              transition={150}
              accessibilityLabel={cover.altText ?? vehicle.title}
            />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <AppText muted variant="caption">
                No image
              </AppText>
            </View>
          )}
          <View style={{ position: 'absolute', top: spacing.sm, right: spacing.sm }}>
            <SaveButton vehicleId={vehicle.id} size="sm" />
          </View>
        </View>

        <View style={{ padding: spacing.md }}>
          <AppText variant="subtitle" numberOfLines={1}>
            {vehicle.title}
          </AppText>
          <AppText muted variant="caption" style={{ marginTop: 2 }}>
            {titleCase(vehicle.make)} {titleCase(vehicle.model)} · {vehicle.year} · {vehicle.seatingCapacity} seats
          </AppText>
          <View style={{ marginTop: spacing.xs }}>
            <CarRatingLine vehicleId={vehicle.id} carRating={vehicle.carRating} fetchIfMissing={false} />
          </View>

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              marginTop: spacing.sm,
            }}
          >
            {weeklyMonthly ? (
              <AppText variant="subtitle" color={colors.primary}>
                {PRICE_TO_AGREE}
              </AppText>
            ) : (
              <AppText variant="subtitle" color={colors.primary}>
                {formatPrice(vehicle.pricePerDay)}
                <AppText muted variant="caption">
                  {' '}
                  / day
                </AppText>
              </AppText>
            )}
            {vehicle.distanceKm !== undefined ? (
              <AppText variant="caption" color={colors.primary}>
                {formatDistance(vehicle.distanceKm)}
              </AppText>
            ) : vehicle.showroom?.city ? (
              <AppText muted variant="caption" style={{ textTransform: 'capitalize' }}>
                {vehicle.showroom.city}
              </AppText>
            ) : null}
          </View>
          {weeklyMonthly && onAskForPrice ? (
            <AppButton
              title="Ask for a price"
              variant="outline"
              onPress={onAskForPrice}
              style={{ marginTop: spacing.sm }}
            />
          ) : null}
        </View>
      </AppCard>
    </Pressable>
  );
}
