import { View } from 'react-native';

import { AppText } from '../../../components/ui';
import { RatingBadge } from '../../../components/reviews/RatingBadge';
import { RatingSummaryBadge } from '../../../components/reviews/RatingSummaryBadge';
import { useTheme } from '../../../theme';
import type { CarRating } from '../../../types/api.types';

interface CarRatingLineProps {
  vehicleId: string;
  // The listing's own figures (A87). An older backend doesn't send them —
  // the line then asks GET /reviews/summary itself, unless `fetchIfMissing`
  // is false (a list card — one request per card is too many).
  carRating?: CarRating;
  fetchIfMissing?: boolean;
}

// "This exact car · ★ 4.6 (12) · 30 rides on KerayeGo" (A87): the customer
// requests this car — the one in the photos, identified by its plate — and
// the rating and rides are that car's own, across every listing of its plate.
export function CarRatingLine({ vehicleId, carRating, fetchIfMissing = true }: CarRatingLineProps) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
      <AppText variant="caption" color={colors.primary} style={{ fontFamily: 'Outfit_600SemiBold' }}>
        {carRating || fetchIfMissing ? 'This exact car ·' : 'This exact car'}
      </AppText>
      {carRating ? (
        <RatingBadge
          average={carRating.averageRating}
          count={carRating.reviewCount}
          rideCount={carRating.rideCount}
          size="sm"
        />
      ) : fetchIfMissing ? (
        <RatingSummaryBadge subjectType="VEHICLE" subjectId={vehicleId} size="sm" />
      ) : null}
    </View>
  );
}
