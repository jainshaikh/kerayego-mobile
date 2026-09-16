import { View } from 'react-native';
import { AppText } from '../ui';
import { useTheme } from '../../theme';

interface RatingBadgeProps {
  average: number | null;
  count: number;
  /** USER subjects only — completed carpool trips (as rider or driver), shown alongside the rating. */
  tripsCount?: number;
  size?: 'sm' | 'md';
}

function tripsLabel(tripsCount: number): string {
  return `${tripsCount} ${tripsCount === 1 ? 'trip' : 'trips'} completed`;
}

// Compact "★ 4.8 (23)" summary for headers/cards — falls back to "No ratings yet".
// tripsCount (driver/rider profiles only) appends "· N trips completed",
// since a user can have completed rides nobody got around to rating.
export function RatingBadge({ average, count, tripsCount, size = 'md' }: RatingBadgeProps) {
  const { colors, spacing } = useTheme();
  const variant = size === 'sm' ? 'caption' : 'body';

  if (!count || average === null) {
    return (
      <AppText muted variant={variant}>
        No ratings yet{tripsCount ? ` · ${tripsLabel(tripsCount)}` : ''}
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
    </View>
  );
}
