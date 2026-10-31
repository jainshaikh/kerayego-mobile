import { View } from 'react-native';
import { AppText } from '../ui';
import { useTheme } from '../../theme';
import { rideCountLabel } from '../../features/reviews/plateHistory';

interface RatingBadgeProps {
  average: number | null;
  count: number;
  /** USER subjects only — completed carpool trips (as rider or driver), shown alongside the rating. */
  tripsCount?: number;
  /** Car subjects only — the plate's rides on KerayeGo, shown alongside the rating when > 0. */
  rideCount?: number;
  size?: 'sm' | 'md';
}

function tripsLabel(tripsCount: number): string {
  return `${tripsCount} ${tripsCount === 1 ? 'trip' : 'trips'} completed`;
}

// Compact "★ 4.8 (23)" summary for headers/cards — falls back to "No ratings yet".
// tripsCount (driver/rider profiles only) appends "· N trips completed",
// since a user can have completed rides nobody got around to rating.
// rideCount (cars only) appends "· N rides on KerayeGo" the same way.
export function RatingBadge({ average, count, tripsCount, rideCount, size = 'md' }: RatingBadgeProps) {
  const { colors, spacing } = useTheme();
  const variant = size === 'sm' ? 'caption' : 'body';
  const rides = rideCountLabel(rideCount);

  if (!count || average === null) {
    return (
      <AppText muted variant={variant}>
        No ratings yet{tripsCount ? ` · ${tripsLabel(tripsCount)}` : ''}
        {rides ? ` · ${rides}` : ''}
      </AppText>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
      <AppText style={{ color: colors.warning }}>★</AppText>
      <AppText variant={variant} style={{ fontFamily: 'Outfit_600SemiBold' }}>
        {average.toFixed(1)}
      </AppText>
      <AppText muted variant={variant}>
        ({count})
      </AppText>
      {tripsCount ? (
        <AppText muted variant={variant}>
          · {tripsLabel(tripsCount)}
        </AppText>
      ) : null}
      {rides ? (
        <AppText muted variant={variant}>
          · {rides}
        </AppText>
      ) : null}
    </View>
  );
}
