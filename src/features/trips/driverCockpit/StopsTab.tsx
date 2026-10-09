import { ScrollView, View } from 'react-native';
import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ManifestRouteStop } from '../../../api/trips.api';
import { formatDistance } from '../../../utils/format';
import { StopCard } from './StopCard';
import type { ServerClock } from './noShow';
import type { StopResolution } from './stopProgress';

interface StopsTabProps {
  loading: boolean;
  stopResolutions: StopResolution[];
  nextStop: ManifestRouteStop | null;
  nextStopDistanceM: number | null;
  selectedStopId: string | null;
  nextStopArrived: boolean;
  canConfirmArrival: boolean;
  arrivedPending: boolean;
  serverClock: ServerClock | null;
  // Whether this tab is the one showing — wait timers only tick then.
  visible: boolean;
  onConfirmArrival: (stop: ManifestRouteStop) => void;
  onSelectStop: (stopId: string) => void;
}

// Stops tab (design spec §4.1): flat, ordered list of every stop — one Card
// each, never grouped/nested by rider.
export function StopsTab({
  loading,
  stopResolutions,
  nextStop,
  nextStopDistanceM,
  selectedStopId,
  nextStopArrived,
  canConfirmArrival,
  arrivedPending,
  serverClock,
  visible,
  onConfirmArrival,
  onSelectStop,
}: StopsTabProps) {
  const { spacing } = useTheme();

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      {loading ? (
        <AppText muted variant="caption">
          Loading…
        </AppText>
      ) : !stopResolutions.length ? (
        <AppText muted variant="caption">
          No stops on this trip yet.
        </AppText>
      ) : (
        <View style={{ gap: spacing.md }}>
          {stopResolutions.map(({ stop, riders, resolved, skipped }, index) => {
            const isNextStop = nextStop?.id === stop.id;
            const status = skipped ? 'skipped' : resolved ? 'reached' : isNextStop ? 'next' : 'upcoming';
            const distanceLabel =
              isNextStop && nextStopDistanceM !== null ? formatDistance(nextStopDistanceM / 1000) : null;
            const riderNames = riders.map((r) => r.user.name).join(' · ');
            return (
              <StopCard
                key={stop.id}
                stop={stop}
                sequence={index + 1}
                status={status}
                isSelected={selectedStopId === stop.id}
                isNextStop={isNextStop}
                distanceLabel={distanceLabel}
                riderNames={riderNames}
                nextStopArrived={nextStopArrived}
                canConfirmArrival={canConfirmArrival}
                arrivedPending={arrivedPending}
                arrivedAt={stop.arrivedAt}
                serverClock={serverClock}
                visible={visible}
                onReach={() => {
                  // Only ever confirms arrival for the real nextStop — never
                  // selectedStopId/previewStop — regardless of which card
                  // this callback was built for.
                  if (nextStop && stop.id === nextStop.id) onConfirmArrival(nextStop);
                }}
                onSelect={() => onSelectStop(stop.id)}
              />
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
