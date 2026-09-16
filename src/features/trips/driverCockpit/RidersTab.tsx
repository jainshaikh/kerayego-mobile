import { ScrollView, View } from 'react-native';
import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ManifestRider } from '../../../api/trips.api';
import { RiderCard } from './RiderCard';

interface RidersTabProps {
  loading: boolean;
  riders: ManifestRider[];
  noShowIds: Set<string>;
  pending: boolean;
  unreadCounts: Record<string, number>;
  onToggleRiderStatus: (rider: ManifestRider) => void;
  onChat: (riderId: string, riderName: string) => void;
}

// Riders tab (design spec §4.2): one Card per rider.
export function RidersTab({ loading, riders, noShowIds, pending, unreadCounts, onToggleRiderStatus, onChat }: RidersTabProps) {
  const { spacing } = useTheme();

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
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
              noShow={noShowIds.has(rider.id)}
              pending={pending}
              unreadCount={unreadCounts[rider.id] ?? 0}
              onAction={() => onToggleRiderStatus(rider)}
              onChat={() => onChat(rider.id, rider.user.name)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
