import { ScrollView, View } from 'react-native';
import { AppButton, AppCard, AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import type { TripStop } from '../../../types/api.types';
import { TripEventType } from '../../../types/enums';
import { REACHED_DOT_BG, REACHED_DOT_FG, UPCOMING_DOT_BG } from '../../liveRide/rideVisuals';
import { formatDistanceShort } from '../../liveRide/geo';
import { openMapsNavigation } from '../../liveRide/openMapsNavigation';
import { formatEtaLabel } from './formatEtaLabel';
import type { RideActionAvailability } from './rideActionAvailability';
import type { RiderStop } from './useRiderLiveRoute';

type RiderEventType = typeof TripEventType.ARRIVED | typeof TripEventType.DROPOFF;

interface StopsTabProps {
  inquiry: TripInquiry;
  pickupStop: RiderStop | null;
  dropoffStop: RiderStop | null;
  dropoffSequence: number;
  pickupDistanceM: number | null;
  dropoffDistanceM: number | null;
  pickupReached: boolean;
  riderConfirmedAtPickup: boolean;
  showEta: boolean;
  etaMinutes: number | null;
  driverDistanceKm: number | null;
  vehicleName: string;
  vehiclePlate: string;
  rideActionAvailability: RideActionAvailability;
  actioningType: RiderEventType | null;
  onRiderEvent: (type: RiderEventType) => void;
  tripStopsSorted: TripStop[];
  tripStopsLoading: boolean;
  actionError: string | null;
}

// Stops tab of the rider's live view: a "driver on the way" live card (once
// self-confirmed at pickup), the rider's own pickup/dropoff cards with their
// geofence-gated action buttons, and a de-emphasized overview of every other
// stop on the whole trip.
export function StopsTab({
  inquiry,
  pickupStop,
  dropoffStop,
  dropoffSequence,
  pickupDistanceM,
  dropoffDistanceM,
  pickupReached,
  riderConfirmedAtPickup,
  showEta,
  etaMinutes,
  driverDistanceKm,
  vehicleName,
  vehiclePlate,
  rideActionAvailability,
  actioningType,
  onRiderEvent,
  tripStopsSorted,
  tripStopsLoading,
  actionError,
}: StopsTabProps) {
  const { colors, spacing } = useTheme();
  const { showArriveButton, canArrive, arriveDisabledReason, showCompleteButton, canComplete, completeDisabledReason } =
    rideActionAvailability;

  const pickupDistanceLabel = pickupDistanceM !== null ? `${formatDistanceShort(pickupDistanceM / 1000)} from you` : null;
  const driverDistanceLabel = driverDistanceKm !== null ? formatDistanceShort(driverDistanceKm) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ gap: spacing.md }}>
        {riderConfirmedAtPickup ? (
          <AppCard style={{ borderColor: colors.primary }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
              <AppText variant="label">Driver on the way</AppText>
              <StatusBadge label="Live" tone="success" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.sm }}>
              <AppText variant="title" color={colors.primary}>
                {showEta ? formatEtaLabel(etaMinutes as number) : 'Calculating…'}
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
          <AppCard style={{ borderColor: pickupReached ? colors.border : colors.primary }}>
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pickupReached ? REACHED_DOT_BG : colors.primary,
                }}
              >
                <AppText variant="label" color={pickupReached ? REACHED_DOT_FG : colors.primaryText}>
                  1
                </AppText>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
                  <AppText variant="label" color={colors.primary}>
                    Your pickup
                  </AppText>
                  {pickupDistanceLabel ? (
                    <AppText muted variant="caption">
                      {pickupDistanceLabel}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="subtitle" numberOfLines={1}>
                  {pickupStop.label}
                </AppText>
                <AppText muted variant="caption">
                  {pickupReached ? 'You confirmed you are here.' : 'Be at the stop before the driver arrives.'}
                </AppText>
              </View>
              <StatusBadge label={pickupReached ? 'Waiting Here' : 'Not There Yet'} tone={pickupReached ? 'success' : 'warning'} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <AppButton
                  title={pickupReached ? "I'm at the stop" : 'I reached the stop'}
                  variant={pickupReached ? 'outline' : 'primary'}
                  loading={actioningType === TripEventType.ARRIVED}
                  disabled={pickupReached || !showArriveButton || !canArrive || actioningType !== null}
                  onPress={() => onRiderEvent(TripEventType.ARRIVED)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton title="Navigate there" variant="ghost" onPress={() => openMapsNavigation(pickupStop)} />
              </View>
            </View>
            {!pickupReached && showArriveButton && !canArrive ? (
              <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                {arriveDisabledReason}
              </AppText>
            ) : null}
          </AppCard>
        ) : null}

        {dropoffStop ? (
          <AppCard>
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: inquiry.droppedOffAt ? REACHED_DOT_BG : UPCOMING_DOT_BG,
                }}
              >
                <AppText variant="label" color={inquiry.droppedOffAt ? REACHED_DOT_FG : colors.textMuted}>
                  {dropoffSequence}
                </AppText>
              </View>
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
                  {inquiry.droppedOffAt ? 'You completed this ride.' : 'Complete your ride once you arrive.'}
                </AppText>
              </View>
              <StatusBadge label={inquiry.droppedOffAt ? 'Completed' : 'Upcoming'} tone={inquiry.droppedOffAt ? 'complete' : 'neutral'} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <AppButton
                  title={inquiry.droppedOffAt ? 'Completed' : 'Reached'}
                  variant={inquiry.droppedOffAt ? 'outline' : 'primary'}
                  loading={actioningType === TripEventType.DROPOFF}
                  disabled={!!inquiry.droppedOffAt || !showCompleteButton || !canComplete || actioningType !== null}
                  onPress={() => onRiderEvent(TripEventType.DROPOFF)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton title="Navigate there" variant="ghost" onPress={() => openMapsNavigation(dropoffStop)} />
              </View>
            </View>
            {!inquiry.droppedOffAt && showCompleteButton && !canComplete ? (
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
          ) : tripStopsSorted.length === 0 ? (
            <AppText muted variant="caption">
              Route details aren&apos;t available right now.
            </AppText>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {tripStopsSorted.map((stop) => {
                const mine = stop.id === pickupStop?.id || stop.id === dropoffStop?.id;
                return (
                  <View key={stop.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: mine ? colors.primary : colors.borderStrong,
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
