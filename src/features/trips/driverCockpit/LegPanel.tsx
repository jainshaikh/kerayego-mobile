import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppButton, AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ManifestRouteStop } from '../../../api/trips.api';
import { RideAvatar } from '../../liveRide/components/RideAvatar';
import { formatDistanceShort } from '../../liveRide/geo';
import type { LegState, LegStop } from './legState';
import type { LegRoute } from './useLegRoute';
import { ARRIVAL_RADIUS_METERS } from './useDriverStopProgress';
import { AUTO_ARRIVAL_RADIUS_METERS } from './useAutoArrival';
import { NO_SHOW_MIN_WAIT_MINUTES, type NoShowContext, type ServerClock } from './noShow';
import { NoShowControl } from './RiderCard';
import { StopWaitTimer } from './StopWaitTimer';
import { isRiderDoneAtStop, type CockpitRider } from './stopProgress';

export type CockpitSheet = 'route' | 'riders' | 'details';

interface LegPanelProps {
  leg: LegState;
  // Whether the manifest (the route itself) has loaded.
  routeStatus: 'loading' | 'failed' | 'ready';
  onRetryRoute: () => void;
  totalStops: number;
  // The ride has ended — nothing left to act on.
  completed: boolean;
  locationDenied: boolean;
  canConfirmArrival: boolean;
  route: LegRoute;
  serverClock: ServerClock | null;
  noShowContext: NoShowContext;
  unreadCounts: Record<string, number>;
  arrivalPending: boolean;
  departurePending: boolean;
  isRiderPending: (riderId: string) => boolean;
  onNavigate: () => void;
  onArrive: () => void;
  onStartNextLeg: () => void;
  onEndRide: () => void;
  onPickedUp: (rider: CockpitRider) => void;
  onDroppedOff: (rider: CockpitRider) => void;
  onNoShow: (rider: CockpitRider) => void;
  onChat: (rider: CockpitRider) => void;
  onOpenSheet: (sheet: CockpitSheet) => void;
}

// The driver's bottom panel during a ride: one stop at a time, per the leg
// state (legState.ts) —
// - navigating: where they're heading, its riders, Navigate + Arrived;
// - at the stop: a checklist of its riders to verify, then Start next leg
//   (End ride at the last stop);
// - done: End ride.
// Route / Riders / Details sheets and End ride stay one tap away underneath.
export function LegPanel(props: LegPanelProps) {
  const { colors, spacing } = useTheme();
  const { leg, routeStatus, onRetryRoute, completed, onOpenSheet, onEndRide } = props;

  return (
    <View style={{ maxHeight: '58%', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.md }}>
        {completed ? (
          <AppText variant="subtitle">Trip completed</AppText>
        ) : routeStatus === 'loading' ? (
          <AppText muted>Loading your route…</AppText>
        ) : routeStatus === 'failed' ? (
          <>
            <AppText variant="subtitle">Couldn&apos;t load your route</AppText>
            <AppText muted variant="caption" style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
              Check your connection and try again — your ride is still in progress.
            </AppText>
            <AppButton title="Try again" variant="secondary" onPress={onRetryRoute} />
          </>
        ) : leg.phase === 'done' || !leg.current ? (
          <RouteDone noStops={leg.stops.length === 0} onEndRide={onEndRide} />
        ) : leg.phase === 'navigating' ? (
          <NavigatingLeg {...props} current={leg.current} />
        ) : (
          <AtStopLeg {...props} current={leg.current} />
        )}
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <SheetLink icon="list-outline" label="Route" onPress={() => onOpenSheet('route')} />
        <SheetLink icon="people-outline" label="Riders" onPress={() => onOpenSheet('riders')} />
        <SheetLink icon="information-circle-outline" label="Details" onPress={() => onOpenSheet('details')} />
        <View style={{ flex: 1 }} />
        {/* Always reachable mid-route (a trip abandoned early); the done
            state above makes it the main action instead. */}
        {!completed && leg.phase !== 'done' ? (
          <SheetLink icon="stop-circle-outline" label="End ride" color={colors.danger} onPress={onEndRide} />
        ) : null}
      </View>
    </View>
  );
}

type LegContentProps = LegPanelProps & { current: LegStop };

function NavigatingLeg({
  current,
  totalStops,
  route,
  locationDenied,
  canConfirmArrival,
  arrivalPending,
  unreadCounts,
  onNavigate,
  onArrive,
  onChat,
}: LegContentProps) {
  const { spacing } = useTheme();
  // Who's still expected here — not someone already sorted out early.
  const riders = current.riders.filter((rider) => !isRiderDoneAtStop(rider, current.stop.type));
  const eta =
    route.remainingMinutes !== null && route.remainingKm !== null
      ? { minutes: `${Math.max(1, Math.round(route.remainingMinutes))} min`, distance: formatDistanceShort(route.remainingKm) }
      : null;

  return (
    <>
      <LegHeader
        stop={current.stop}
        caption={`Stop ${current.index + 1} of ${totalStops}`}
        aside={
          eta ? (
            <View style={{ alignItems: 'flex-end' }}>
              <AppText variant="subtitle">{eta.minutes}</AppText>
              <AppText muted variant="caption">
                {eta.distance}
              </AppText>
            </View>
          ) : null
        }
      />

      {riders.length > 0 ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <AppText muted variant="caption">
            {current.stop.type === 'PICKUP' ? 'Picking up' : 'Dropping off'}
          </AppText>
          {riders.map((rider) => (
            <RiderLine key={rider.id} rider={rider} unread={unreadCounts[rider.id] ?? 0} onChat={() => onChat(rider)} />
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <AppButton title="Navigate" variant="secondary" onPress={onNavigate} />
        </View>
        <View style={{ flex: 1 }}>
          <AppButton
            title="Arrived"
            loading={arrivalPending}
            disabled={locationDenied || !canConfirmArrival}
            onPress={onArrive}
          />
        </View>
      </View>
      <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
        {locationDenied
          ? 'Location access is needed to mark your arrival. Enable location permission for this app in your device settings.'
          : canConfirmArrival
            ? `Tap Arrived when you're there — it's marked for you once you've stopped within ${AUTO_ARRIVAL_RADIUS_METERS} m.`
            : `Get within ${ARRIVAL_RADIUS_METERS} m of this stop to mark your arrival.`}
      </AppText>
    </>
  );
}

function AtStopLeg({
  leg,
  current,
  totalStops,
  serverClock,
  noShowContext,
  unreadCounts,
  departurePending,
  isRiderPending,
  onStartNextLeg,
  onEndRide,
  onPickedUp,
  onDroppedOff,
  onNoShow,
  onChat,
}: LegContentProps) {
  const { colors, spacing } = useTheme();
  const isPickup = current.stop.type === 'PICKUP';
  // A rider marked as a no-show at pickup was never on board — nothing to
  // drop off for them here.
  const riders = isPickup ? current.riders : current.riders.filter((rider) => !rider.noShow);
  const verified = riders.filter((rider) => isRiderDoneAtStop(rider, current.stop.type)).length;

  return (
    <>
      <LegHeader
        stop={current.stop}
        caption={`Arrived · Stop ${current.index + 1} of ${totalStops}`}
        aside={
          isPickup ? <StopWaitTimer arrivedAt={current.stop.arrivedAt} serverClock={serverClock} visible /> : null
        }
      />

      {riders.length > 0 ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
            <AppText variant="label">{isPickup ? 'Verify pickups' : 'Verify drop-offs'}</AppText>
            <AppText muted variant="caption">
              {verified} of {riders.length} done
            </AppText>
          </View>
          {riders.map((rider) => (
            <StopRiderRow
              key={rider.id}
              rider={rider}
              stopType={current.stop.type}
              noShowContext={noShowContext}
              pending={isRiderPending(rider.id)}
              unread={unreadCounts[rider.id] ?? 0}
              onPickedUp={() => onPickedUp(rider)}
              onDroppedOff={() => onDroppedOff(rider)}
              onNoShow={() => onNoShow(rider)}
              onChat={() => onChat(rider)}
            />
          ))}
        </>
      ) : (
        <AppText muted variant="caption" style={{ marginTop: spacing.md }}>
          No riders left to {isPickup ? 'pick up' : 'drop off'} here.
        </AppText>
      )}

      <View style={{ marginTop: spacing.lg }}>
        {leg.next ? (
          <AppButton
            title={`Start next leg · ${leg.next.stop.label}`}
            loading={departurePending}
            disabled={!leg.canStartNextLeg}
            onPress={onStartNextLeg}
          />
        ) : (
          <AppButton title="End ride" variant="danger" disabled={!leg.canStartNextLeg} onPress={onEndRide} />
        )}
        {!leg.canStartNextLeg ? (
          <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
            {isPickup
              ? `Mark each rider picked up — or a no-show after ${NO_SHOW_MIN_WAIT_MINUTES} min of waiting — to continue.`
              : 'Mark each rider dropped off to continue.'}
          </AppText>
        ) : null}
      </View>
      {leg.next ? null : (
        <AppText color={colors.textMuted} variant="caption" style={{ marginTop: spacing.xs }}>
          This is the last stop on your route.
        </AppText>
      )}
    </>
  );
}

// noStops: the route loaded but has no stops — no confirmed rider on this trip.
function RouteDone({ noStops, onEndRide }: { noStops: boolean; onEndRide: () => void }) {
  const { spacing } = useTheme();
  return (
    <>
      <AppText variant="subtitle">{noStops ? 'No riders on this trip' : 'All stops done'}</AppText>
      <AppText muted variant="caption" style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
        {noStops
          ? 'Nobody has a confirmed seat, so there are no stops to drive to.'
          : 'End the ride to finish the trip for you and your riders.'}
      </AppText>
      <AppButton title="End ride" variant="danger" onPress={onEndRide} />
    </>
  );
}

function LegHeader({ stop, caption, aside }: { stop: ManifestRouteStop; caption: string; aside: ReactNode }) {
  const { colors, spacing, radii } = useTheme();
  const isPickup = stop.type === 'PICKUP';
  // Pickup coral, drop-off ink — the same split as the trip form and the
  // route overview.
  const kindColor = isPickup ? colors.primary : colors.text;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
              borderRadius: radii.full,
              borderWidth: 1,
              borderColor: kindColor,
            }}
          >
            <Ionicons name={isPickup ? 'radio-button-on' : 'flag'} size={12} color={kindColor} />
            <AppText variant="caption" color={kindColor} style={{ fontWeight: '600' }}>
              {isPickup ? 'Pickup' : 'Drop-off'}
            </AppText>
          </View>
          <AppText muted variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
            {caption}
          </AppText>
        </View>
        <AppText variant="subtitle" numberOfLines={2}>
          {stop.label}
        </AppText>
      </View>
      {aside}
    </View>
  );
}

// A rider expected at the stop being driven to: who, how many seats, any
// pickup note — and chat.
function RiderLine({ rider, unread, onChat }: { rider: CockpitRider; unread: number; onChat: () => void }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <RideAvatar name={rider.user.name} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="label" numberOfLines={1}>
          {rider.user.name}
        </AppText>
        <AppText muted variant="caption" numberOfLines={1}>
          {seatsLabel(rider)}
        </AppText>
      </View>
      <ChatButton unread={unread} onPress={onChat} />
    </View>
  );
}

interface StopRiderRowProps {
  rider: CockpitRider;
  stopType: ManifestRouteStop['type'];
  noShowContext: NoShowContext;
  pending: boolean;
  unread: number;
  onPickedUp: () => void;
  onDroppedOff: () => void;
  onNoShow: () => void;
  onChat: () => void;
}

// One rider in the at-stop checklist: verify them (Picked up / No-show at a
// pickup, Dropped off at a drop-off), or see that they're done.
function StopRiderRow({
  rider,
  stopType,
  noShowContext,
  pending,
  unread,
  onPickedUp,
  onDroppedOff,
  onNoShow,
  onChat,
}: StopRiderRowProps) {
  const { colors, spacing } = useTheme();
  const isPickup = stopType === 'PICKUP';
  const done = isRiderDoneAtStop(rider, stopType);
  const badge = rider.droppedOffAt
    ? { label: 'Dropped off', tone: 'complete' as const }
    : rider.noShow
      ? { label: 'No-show', tone: 'danger' as const }
      : rider.pickupConfirmedAt && isPickup
        ? { label: 'On board', tone: 'success' as const }
        : null;

  return (
    <View style={{ paddingTop: spacing.md, marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <RideAvatar name={rider.user.name} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label" numberOfLines={1}>
            {rider.user.name}
          </AppText>
          <AppText muted variant="caption" numberOfLines={2}>
            {seatsLabel(rider)}
          </AppText>
        </View>
        <ChatButton unread={unread} onPress={onChat} />
        {done && badge ? <StatusBadge label={badge.label} tone={badge.tone} /> : null}
      </View>

      {!done ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton
              title={isPickup ? 'Picked up' : 'Dropped off'}
              loading={pending}
              onPress={isPickup ? onPickedUp : onDroppedOff}
            />
          </View>
          {isPickup ? (
            <NoShowControl
              rider={rider}
              context={noShowContext}
              visible
              pending={pending}
              onPress={onNoShow}
              style={{ flex: 1, justifyContent: 'center' }}
            />
          ) : null}
        </View>
      ) : rider.noShow && isPickup ? (
        // How a no-show is reversed: they turned up after all.
        <View style={{ marginTop: spacing.sm }}>
          <AppButton title="They turned up — picked up" variant="outline" loading={pending} onPress={onPickedUp} />
        </View>
      ) : null}
    </View>
  );
}

function ChatButton({ unread, onPress }: { unread: number; onPress: () => void }) {
  const { colors, radii } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Chat, ${unread} unread` : 'Chat'}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      })}
    >
      <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.text} />
      {unread > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primary,
          }}
        >
          <AppText variant="caption" color={colors.primaryText} style={{ fontSize: 11, fontWeight: '700' }}>
            {unread > 9 ? '9+' : unread}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

function SheetLink({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color?: string;
  onPress: () => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const tint = color ?? colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        borderRadius: radii.md,
        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
      })}
    >
      <Ionicons name={icon} size={16} color={tint} />
      <AppText variant="caption" color={tint} style={{ fontWeight: '600' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function seatsLabel(rider: CockpitRider): string {
  const seats = `${rider.requestedSeats} seat${rider.requestedSeats !== 1 ? 's' : ''}`;
  return rider.pickupNote ? `${seats} · ${rider.pickupNote}` : seats;
}
