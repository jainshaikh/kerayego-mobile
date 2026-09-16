import { Pressable, View } from 'react-native';
import { AppButton, AppCard, AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ManifestRouteStop } from '../../../api/trips.api';
import { REACHED_DOT_BG, REACHED_DOT_FG, UPCOMING_DOT_BG } from '../../liveRide/rideVisuals';

export type StopCardStatus = 'reached' | 'next' | 'upcoming';

function StopSequenceDot({ status, sequence }: { status: StopCardStatus; sequence: number }) {
  const { colors } = useTheme();
  const bg = status === 'reached' ? REACHED_DOT_BG : status === 'next' ? colors.primary : UPCOMING_DOT_BG;
  const fg = status === 'reached' ? REACHED_DOT_FG : status === 'next' ? colors.primaryText : colors.textMuted;
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}>
      <AppText variant="label" color={fg}>
        {sequence}
      </AppText>
    </View>
  );
}

interface StopCardProps {
  stop: ManifestRouteStop;
  sequence: number;
  status: StopCardStatus;
  isSelected: boolean;
  isNextStop: boolean;
  distanceLabel: string | null;
  // Riders at this stop, pre-joined into one display line by the caller.
  riderNames: string;
  nextStopArrived: boolean;
  canConfirmArrival: boolean;
  arrivedPending: boolean;
  onReach: () => void;
  onSelect: () => void;
}

// One stop's card in the driver's Stops tab (design spec §4.1) — a flat,
// ordered list, never grouped/nested by rider.
export function StopCard({
  stop,
  sequence,
  status,
  isSelected,
  isNextStop,
  distanceLabel,
  riderNames,
  nextStopArrived,
  canConfirmArrival,
  arrivedPending,
  onReach,
  onSelect,
}: StopCardProps) {
  const { colors, spacing } = useTheme();
  const reached = status === 'reached';
  const kindLabel = stop.type === 'PICKUP' ? 'Pickup' : 'Dropoff';
  const kindColor = stop.type === 'PICKUP' ? colors.primary : colors.text;
  const badge =
    status === 'reached'
      ? { label: 'Reached', tone: 'complete' as const }
      : status === 'next'
        ? { label: 'Next', tone: 'accent' as const }
        : { label: 'Upcoming', tone: 'neutral' as const };

  // Only the real next stop's button is ever actionable — its
  // enabled/disabled state reads nextStopArrived/canConfirmArrival, both
  // computed strictly from nextStop upstream. Every other stop's button is
  // permanently disabled, regardless of this card's own selection state.
  const buttonReached = reached || (isNextStop && nextStopArrived);
  const reachDisabled = !isNextStop || nextStopArrived || !canConfirmArrival;

  return (
    <Pressable onPress={onSelect} accessibilityRole="button">
      <AppCard style={{ opacity: reached ? 0.7 : 1, borderColor: isSelected ? colors.primary : colors.border }}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
          <StopSequenceDot status={status} sequence={sequence} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <AppText variant="label" color={kindColor}>
                {kindLabel}
              </AppText>
              {distanceLabel ? (
                <AppText muted variant="caption">
                  {distanceLabel}
                </AppText>
              ) : null}
            </View>
            <AppText variant="subtitle" numberOfLines={1}>
              {stop.label}
            </AppText>
            {riderNames ? (
              <AppText muted variant="caption" numberOfLines={1}>
                {riderNames}
              </AppText>
            ) : null}
          </View>
          <StatusBadge label={badge.label} tone={badge.tone} />
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <AppButton
              title={buttonReached ? 'Reached' : 'I reached'}
              variant={isNextStop ? 'primary' : 'outline'}
              disabled={reachDisabled}
              loading={isNextStop && arrivedPending}
              onPress={onReach}
            />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton title={isSelected ? 'Showing on map' : 'Show on map'} variant="ghost" onPress={onSelect} />
          </View>
        </View>
      </AppCard>
    </Pressable>
  );
}
