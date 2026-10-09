import { View } from 'react-native';
import { AppButton, AppCard, AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useNow } from '../../../hooks/useNow';
import { RideAvatar } from '../../liveRide/components/RideAvatar';
import { formatCountdown, NO_SHOW_MIN_WAIT_MINUTES, noShowGate, noShowRemainingMs, type NoShowContext } from './noShow';
import type { CockpitRider } from './stopProgress';

interface RiderCardProps {
  rider: CockpitRider;
  noShowContext: NoShowContext;
  // Whether the card is on screen — the no-show countdown only ticks then.
  visible: boolean;
  pending: boolean;
  unreadCount: number;
  onAction: () => void;
  onNoShow: () => void;
  onChat: () => void;
}

interface NoShowControlProps {
  rider: CockpitRider;
  context: NoShowContext;
  visible: boolean;
  pending: boolean;
  onPress: () => void;
}

// "Didn't show" — only once the driver's Reached at this rider's pickup stop
// is on the server, disabled with a countdown until the five-minute wait is
// over. Its own component so the once-a-second tick re-renders just this.
function NoShowControl({ rider, context, visible, pending, onPress }: NoShowControlProps) {
  const { spacing } = useTheme();
  const gate = noShowGate(rider, context);
  const now = useNow(visible && gate.state === 'timed');

  if (gate.state === 'hidden') return null;
  if (gate.state === 'arrivalUnsynced') {
    return (
      <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
        You can mark a no-show {NO_SHOW_MIN_WAIT_MINUTES} min after your arrival here syncs.
      </AppText>
    );
  }

  const remainingMs = noShowRemainingMs(gate.arrivedAtMs, gate.clock, now);
  const waiting = remainingMs > 0;
  return (
    <View style={{ marginTop: spacing.sm }}>
      <AppButton
        title={waiting ? `No-show in ${formatCountdown(remainingMs)}` : "Didn't show"}
        variant="outline"
        disabled={waiting || pending}
        onPress={onPress}
      />
    </View>
  );
}

// One rider's card in the driver's Riders tab (design spec §4.2).
export function RiderCard({
  rider,
  noShowContext,
  visible,
  pending,
  unreadCount,
  onAction,
  onNoShow,
  onChat,
}: RiderCardProps) {
  const { spacing } = useTheme();
  const pickedUp = !!rider.pickupConfirmedAt;
  const droppedOff = !!rider.droppedOffAt;
  const noShow = rider.noShow;

  const phaseLabel = droppedOff ? 'Trip finished' : pickedUp ? 'On board' : noShow ? 'No-show logged' : 'Awaiting pickup';
  const meta = `${rider.requestedSeats} seat${rider.requestedSeats !== 1 ? 's' : ''} · ${phaseLabel}`;
  const stopLine = `${rider.pickupStop?.label ?? '—'} → ${rider.dropoffStop?.label ?? '—'}`;
  const badge = droppedOff
    ? { label: 'Dropped', tone: 'complete' as const }
    : pickedUp
      ? { label: 'On Board', tone: 'success' as const }
      : noShow
        ? { label: 'No-show', tone: 'danger' as const }
        : { label: 'Awaiting Pickup', tone: 'warning' as const };
  // A no-show still offers "Picked up": that's how the driver reverses it.
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
          {noShow ? (
            <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
              If they turn up after all, tap Picked up.
            </AppText>
          ) : null}
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
      <NoShowControl rider={rider} context={noShowContext} visible={visible} pending={pending} onPress={onNoShow} />
    </AppCard>
  );
}
