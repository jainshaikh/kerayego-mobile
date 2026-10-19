import { ScrollView, View } from 'react-native';
import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { RiderCard } from './RiderCard';
import type { NoShowContext } from './noShow';
import type { CockpitRider } from './stopProgress';

interface RidersTabProps {
  loading: boolean;
  riders: CockpitRider[];
  noShowContext: NoShowContext;
  // Whether this tab is the one showing — no-show countdowns only tick then.
  visible: boolean;
  isRiderPending: (riderId: string) => boolean;
  unreadCounts: Record<string, number>;
  onToggleRiderStatus: (rider: CockpitRider) => void;
  onNoShow: (rider: CockpitRider) => void;
  onChat: (riderId: string, riderName: string) => void;
}

// The cockpit's Riders sheet (design spec §4.2): one Card per rider — every
// rider at once, for actions out of route order (e.g. an early drop-off).
// The sheet supplies the side padding.
export function RidersTab({
  loading,
  riders,
  noShowContext,
  visible,
  isRiderPending,
  unreadCounts,
  onToggleRiderStatus,
  onNoShow,
  onChat,
}: RidersTabProps) {
  const { spacing } = useTheme();

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: spacing.xs }}>
      {loading ? (
        <AppText muted variant="caption">
          Loading…
        </AppText>
      ) : !riders.length ? (
        <AppText muted variant="caption">
          No confirmed riders on this trip.
        </AppText>
      ) : (
        <View style={{ gap: spacing.md }}>
          {riders.map((rider) => (
            <RiderCard
              key={rider.id}
              rider={rider}
              noShowContext={noShowContext}
              visible={visible}
              pending={isRiderPending(rider.id)}
              unreadCount={unreadCounts[rider.id] ?? 0}
              onAction={() => onToggleRiderStatus(rider)}
              onNoShow={() => onNoShow(rider)}
              onChat={() => onChat(rider.id, rider.user.name)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
