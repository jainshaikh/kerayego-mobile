import { View } from 'react-native';
import { AppButton, AppCard, AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ManifestRider } from '../../../api/trips.api';
import { RideAvatar } from '../../liveRide/components/RideAvatar';

interface RiderCardProps {
  rider: ManifestRider;
  noShow: boolean;
  pending: boolean;
  unreadCount: number;
  onAction: () => void;
  onChat: () => void;
}

// One rider's card in the driver's Riders tab (design spec §4.2).
export function RiderCard({ rider, noShow, pending, unreadCount, onAction, onChat }: RiderCardProps) {
  const { spacing } = useTheme();
  const pickedUp = !!rider.pickupConfirmedAt;
  const droppedOff = !!rider.droppedOffAt;

  const phaseLabel = droppedOff ? 'Trip finished' : pickedUp ? 'On board' : noShow ? 'No-show logged' : 'Awaiting pickup';
  const meta = `${rider.requestedSeats} seat${rider.requestedSeats !== 1 ? 's' : ''} · ${phaseLabel}`;
  const stopLine = `${rider.pickupStop?.label ?? '—'} → ${rider.dropoffStop?.label ?? '—'}`;
  const badge = droppedOff
    ? { label: 'Dropped', tone: 'complete' as const }
    : pickedUp
      ? { label: 'On Board', tone: 'success' as const }
      : { label: 'Awaiting Pickup', tone: 'warning' as const };
  const actionTitle = droppedOff || pickedUp ? 'Dropped off' : 'Picked up';
  const chatTitle = unreadCount > 0 ? `Chat · ${unreadCount}` : 'Chat';

  return (
    <AppCard>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
        <RideAvatar name={rider.user.name} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="subtitle" numberOfLines={1}>
            {rider.user.name}
          </AppText>
          <AppText muted variant="caption" numberOfLines={1}>
            {meta}
          </AppText>
          <AppText muted variant="caption" numberOfLines={1}>
            {stopLine}
          </AppText>
        </View>
        <StatusBadge label={badge.label} tone={badge.tone} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <View style={{ flex: 1 }}>
          <AppButton
            title={actionTitle}
            variant={droppedOff ? 'outline' : 'primary'}
            disabled={droppedOff}
            loading={pending}
            onPress={onAction}
          />
        </View>
        <View style={{ flex: 1 }}>
          <AppButton title={chatTitle} variant="outline" onPress={onChat} />
        </View>
      </View>
    </AppCard>
  );
}
