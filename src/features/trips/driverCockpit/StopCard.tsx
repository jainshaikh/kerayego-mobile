import { Pressable, View } from 'react-native';
import { AppButton, AppCard, AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ManifestRouteStop } from '../../../api/trips.api';
import { REACHED_DOT_BG, REACHED_DOT_FG, UPCOMING_DOT_BG } from '../../liveRide/rideVisuals';
import type { ServerClock } from './noShow';
import { StopWaitTimer } from './StopWaitTimer';

// 'skipped': a drop-off stop whose riders were all no-shows — done, with
// nobody to drop off there.
export type StopCardStatus = 'reached' | 'skipped' | 'next' | 'upcoming';

function StopSequenceDot({ status, sequence }: { status: StopCardStatus; sequence: number }) {
  const { colors } = useTheme();
  const done = status === 'reached' || status === 'skipped';
  const bg = done ? REACHED_DOT_BG : status === 'next' ? colors.primary : UPCOMING_DOT_BG;
  const fg = done ? REACHED_DOT_FG : status === 'next' ? colors.primaryText : colors.textMuted;
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
  // The server's arrival here (routeStops[].arrivedAt) and its clock — drive
  // the "Waiting m:ss" line on a pickup stop that's still being worked.
  arrivedAt: string | null | undefined;
  serverClock: ServerClock | null;
  // Whether the Stops tab is showing — the wait line only ticks then.
  visible: boolean;
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
  arrivedAt,
  serverClock,
  visible,
  onReach,
  onSelect,
}: StopCardProps) {
  const { colors, spacing } = useTheme();
  const skipped = status === 'skipped';
  const reached = status === 'reached' || skipped;
  const kindLabel = stop.type === 'PICKUP' ? 'Pickup' : 'Dropoff';
  const kindColor = stop.type === 'PICKUP' ? colors.primary : colors.text;
  const badge =
    status === 'reached'
      ? { label: 'Reached', tone: 'complete' as const }
      : skipped
        ? { label: 'Skipped', tone: 'neutral' as const }
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
            {stop.type === 'PICKUP' && !reached ? (
              <StopWaitTimer arrivedAt={arrivedAt} serverClock={serverClock} visible={visible} />
            ) : null}
          </View>
          <StatusBadge label={badge.label} tone={badge.tone} />
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <AppButton
              title={skipped ? 'Not needed' : buttonReached ? 'Reached' : 'I reached'}
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
