import { ScrollView, View } from 'react-native';

import { AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { REACHED_DOT_BG, REACHED_DOT_FG } from '../../liveRide/rideVisuals';
import type { LegStop, StopLegStatus } from './legState';

const BADGES: Record<StopLegStatus, { label: string; tone: 'complete' | 'neutral' | 'accent' }> = {
  done: { label: 'Done', tone: 'complete' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  current: { label: 'Current', tone: 'accent' },
  upcoming: { label: 'Upcoming', tone: 'neutral' },
};

const DOT_SIZE = 26;

// The whole route at a glance, for the cockpit's Route sheet — the map itself
// only ever shows the current leg. Read-only: every action happens on the
// current stop in the leg panel (or the Riders sheet).
export function RouteOverview({ stops }: { stops: LegStop[] }) {
  const { colors, spacing } = useTheme();

  if (stops.length === 0) {
    return (
      <AppText muted variant="caption">
        No stops on this route yet.
      </AppText>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: spacing.xs }}>
      {stops.map((stop, i) => {
        const isPickup = stop.stop.type === 'PICKUP';
        const dot =
          stop.status === 'current'
            ? { bg: colors.primary, fg: colors.primaryText }
            : stop.status === 'done'
              ? { bg: REACHED_DOT_BG, fg: REACHED_DOT_FG }
              : { bg: colors.surfaceAlt, fg: colors.textMuted };
        const badge = BADGES[stop.status];

        return (
          <View key={stop.stop.id} style={{ flexDirection: 'row', gap: spacing.md }}>
            {/* Numbered dot, with a rail down to the next stop. */}
            <View style={{ width: DOT_SIZE, alignItems: 'center' }}>
              <View
                style={{
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: dot.bg,
                }}
              >
                <AppText variant="caption" color={dot.fg} style={{ fontWeight: '700' }}>
                  {stop.index + 1}
                </AppText>
              </View>
              {i < stops.length - 1 ? (
                <View style={{ flex: 1, width: 2, minHeight: spacing.md, backgroundColor: colors.border }} />
              ) : null}
            </View>

            <View style={{ flex: 1, minWidth: 0, paddingBottom: spacing.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <AppText variant="caption" color={isPickup ? colors.primary : colors.text} style={{ fontWeight: '600' }}>
                  {isPickup ? 'Pickup' : 'Drop-off'}
                </AppText>
                <StatusBadge label={badge.label} tone={badge.tone} />
              </View>
              <AppText variant="label" numberOfLines={2} style={{ opacity: stop.status === 'skipped' ? 0.6 : 1 }}>
                {stop.stop.label}
              </AppText>
              {stop.riders.length > 0 ? (
                <AppText muted variant="caption" numberOfLines={2}>
                  {stop.riders.map((rider) => rider.user.name).join(', ')}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
