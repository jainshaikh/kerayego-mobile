import { ScrollView, View } from 'react-native';
import { AppButton, AppCard, AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { TripEventType } from '../../../types/enums';
import { formatTripTime } from '../../../utils/tripDateTime';
import { REACHED_DOT_BG, REACHED_DOT_FG, UPCOMING_DOT_BG } from '../../liveRide/rideVisuals';
import { formatDistanceShort } from '../../liveRide/geo';
import { mapsNavigationUrl, openMapsNavigation } from '../../liveRide/openMapsNavigation';
import type { ServerClock } from '../../trips/driverCockpit/noShow';
import { DriverArrivedAgo } from './DriverArrivedAgo';
import { formatEtaLabel } from './formatEtaLabel';
import type { RideActionAvailability } from './rideActionAvailability';
import type { RiderRidePhase } from './riderTripState';
import type { RouteStop } from './routeStops';
import type { RiderStop } from './useRiderLiveRoute';

type RiderEventType = typeof TripEventType.ARRIVED | typeof TripEventType.DROPOFF;

interface StopsTabProps {
  phase: RiderRidePhase;
  pickupStop: RiderStop | null;
  dropoffStop: RiderStop | null;
  pickupSequence: number;
  dropoffSequence: number;
  pickupDistanceM: number | null;
  dropoffDistanceM: number | null;
  pickupConfirmedAt: string | null;
  // The server time the driver reached this rider's pickup stop, if they have.
  driverArrivedAt: string | null;
  serverClock: ServerClock | null;
  // This tab is the one showing — its timers tick only then.
  visible: boolean;
  // The rider's own drop-off is saved offline, not synced yet.
  dropoffQueued: boolean;
  etaMinutes: number | null;
  driverDistanceKm: number | null;
  vehicleName: string;
  vehiclePlate: string;
  rideActionAvailability: RideActionAvailability;
  actioningType: RiderEventType | null;
  onArrived: () => void;
  // Opens the drop-off confirmation sheet.
  onCompleteRide: () => void;
  tripStops: RouteStop[];
  tripStopsLoading: boolean;
  actionError: string | null;
}

function StopNumber({ value, reached, active }: { value: number; reached: boolean; active: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: reached ? REACHED_DOT_BG : active ? colors.primary : UPCOMING_DOT_BG,
      }}
    >
      <AppText variant="label" color={reached ? REACHED_DOT_FG : active ? colors.primaryText : colors.textMuted}>
        {value}
      </AppText>
    </View>
  );
}

// Stops tab of the rider's live view: a "driver on the way" / "driver is
// here" live card before pickup, the rider's own pickup/dropoff cards with
// their geofence-gated action buttons, and a de-emphasized overview of every
// stop on the whole trip. Everything follows the ride phase — the server's
// pickup first, the rider's own "I reached the stop" only before it.
export function StopsTab({
  phase,
  pickupStop,
  dropoffStop,
  pickupSequence,
  dropoffSequence,
  pickupDistanceM,
  dropoffDistanceM,
  pickupConfirmedAt,
  driverArrivedAt,
  serverClock,
  visible,
  dropoffQueued,
  etaMinutes,
  driverDistanceKm,
  vehicleName,
  vehiclePlate,
  rideActionAvailability,
  actioningType,
  onArrived,
  onCompleteRide,
  tripStops,
  tripStopsLoading,
  actionError,
}: StopsTabProps) {
  const { colors, spacing } = useTheme();
  const { showArriveButton, canArrive, arriveDisabledReason, showCompleteButton, canComplete, completeDisabledReason } =
    rideActionAvailability;

  const onBoard = phase === 'onBoard';
  const waiting = phase === 'waitingAtPickup';
  const driverAtPickup = !onBoard && !!driverArrivedAt;
  const pickupDistanceLabel = pickupDistanceM !== null ? `${formatDistanceShort(pickupDistanceM / 1000)} from you` : null;
  const driverDistanceLabel = driverDistanceKm !== null ? formatDistanceShort(driverDistanceKm) : null;

  const pickupBadge = onBoard
    ? { label: 'Picked Up', tone: 'complete' as const }
    : waiting
      ? { label: 'Waiting Here', tone: 'success' as const }
      : { label: 'Not There Yet', tone: 'warning' as const };
  const pickupCaption = onBoard
    ? pickupConfirmedAt
      ? `Picked up at ${formatTripTime(pickupConfirmedAt)}.`
      : 'Picked up.'
    : waiting
      ? 'You confirmed you are here.'
      : 'Be at the stop before the driver arrives.';

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ gap: spacing.md }}>
        {driverAtPickup ? (
          <AppCard style={{ borderColor: colors.success }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
              <AppText variant="label">Your driver is here</AppText>
              <StatusBadge label="Arrived" tone="success" />
            </View>
            <DriverArrivedAgo
              arrivedAt={driverArrivedAt}
              serverClock={serverClock}
              visible={visible}
              style={{ marginTop: spacing.sm }}
            />
            <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
              Look for {vehicleName}, {vehiclePlate}.
            </AppText>
          </AppCard>
        ) : waiting ? (
          <AppCard style={{ borderColor: colors.primary }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
              <AppText variant="label">Driver on the way</AppText>
              <StatusBadge label="Live" tone="success" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.sm }}>
              <AppText variant="title" color={colors.primary}>
                {etaMinutes !== null ? formatEtaLabel(etaMinutes) : 'Calculating…'}
              </AppText>
              {driverDistanceLabel ? (
                <AppText muted variant="caption">
                  {driverDistanceLabel} away
                </AppText>
              ) : null}
            </View>
            <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
              Updated just now · {vehicleName}, {vehiclePlate}.
            </AppText>
          </AppCard>
        ) : null}

        {pickupStop ? (
          <AppCard style={{ borderColor: phase === 'headToPickup' ? colors.primary : colors.border }}>
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
              <StopNumber value={pickupSequence} reached={phase !== 'headToPickup'} active={phase === 'headToPickup'} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
                  <AppText variant="label" color={colors.primary}>
                    Your pickup
                  </AppText>
                  {!onBoard && pickupDistanceLabel ? (
                    <AppText muted variant="caption">
                      {pickupDistanceLabel}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="subtitle" numberOfLines={1}>
                  {pickupStop.label}
                </AppText>
                <AppText muted variant="caption">
                  {pickupCaption}
                </AppText>
              </View>
              <StatusBadge label={pickupBadge.label} tone={pickupBadge.tone} />
            </View>
            {!onBoard ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                {showArriveButton ? (
                  <View style={{ flex: 1 }}>
                    <AppButton
                      title={waiting ? "I'm at the stop" : 'I reached the stop'}
                      variant={waiting ? 'outline' : 'primary'}
                      loading={actioningType === TripEventType.ARRIVED}
                      disabled={waiting || !canArrive || actioningType !== null}
                      onPress={onArrived}
                    />
                  </View>
                ) : null}
                {mapsNavigationUrl(pickupStop) ? (
                  <View style={{ flex: 1 }}>
                    <AppButton title="Navigate there" variant="ghost" onPress={() => openMapsNavigation(pickupStop)} />
                  </View>
                ) : null}
              </View>
            ) : null}
            {!waiting && showArriveButton && !canArrive ? (
              <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                {arriveDisabledReason}
              </AppText>
            ) : null}
          </AppCard>
        ) : null}

        {dropoffStop ? (
          <AppCard style={{ borderColor: onBoard ? colors.primary : colors.border }}>
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
              <StopNumber value={dropoffSequence} reached={dropoffQueued} active={onBoard && !dropoffQueued} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
                  <AppText variant="label">Your dropoff</AppText>
                  {dropoffDistanceM !== null ? (
                    <AppText muted variant="caption">
                      {formatDistanceShort(dropoffDistanceM / 1000)}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="subtitle" numberOfLines={1}>
                  {dropoffStop.label}
                </AppText>
                <AppText muted variant="caption">
                  {dropoffQueued
                    ? "Drop-off saved — it'll sync once you're back online."
                    : 'Complete your ride once you arrive.'}
                </AppText>
              </View>
              <StatusBadge
                label={dropoffQueued ? 'Saved' : onBoard ? 'Next' : 'Upcoming'}
                tone={dropoffQueued ? 'complete' : onBoard ? 'info' : 'neutral'}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              {showCompleteButton ? (
                <View style={{ flex: 1 }}>
                  <AppButton
                    title="Reached"
                    loading={actioningType === TripEventType.DROPOFF}
                    disabled={!canComplete || actioningType !== null}
                    onPress={onCompleteRide}
                  />
                </View>
              ) : null}
              {mapsNavigationUrl(dropoffStop) ? (
                <View style={{ flex: 1 }}>
                  <AppButton title="Navigate there" variant="ghost" onPress={() => openMapsNavigation(dropoffStop)} />
                </View>
              ) : null}
            </View>
            {showCompleteButton && !canComplete ? (
              <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                {completeDisabledReason}
              </AppText>
            ) : null}
          </AppCard>
        ) : null}

        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Stops on this ride
          </AppText>
          {tripStopsLoading ? (
            <AppText muted variant="caption">
              Loading…
            </AppText>
          ) : tripStops.length === 0 ? (
            <AppText muted variant="caption">
              Route details aren&apos;t available right now.
            </AppText>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {tripStops.map((stop) => {
                const mine = stop.id === pickupStop?.id || stop.id === dropoffStop?.id;
                return (
                  <View key={stop.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: stop.arrivedAt ? REACHED_DOT_BG : mine ? colors.primary : colors.borderStrong,
                      }}
                    />
                    <AppText
                      variant="body"
                      color={mine ? colors.text : colors.textMuted}
                      numberOfLines={1}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {stop.label}
                    </AppText>
                    {stop.arrivedAt ? (
                      <AppText muted variant="caption">
                        Driver reached
                      </AppText>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </AppCard>

        {actionError ? <AppText color={colors.danger}>{actionError}</AppText> : null}
      </View>
    </ScrollView>
  );
}
