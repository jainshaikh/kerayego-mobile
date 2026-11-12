import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { BookingRequest } from '../../../types/api.types';
import { BookingTripType } from '../../../types/enums';
import { distanceTimeLabel, minutesLabel, routeStopItems, stopTimeLabel } from '../bookingRoute';

type RouteBooking = Pick<
  BookingRequest,
  | 'requestedFromDate'
  | 'stops'
  | 'tripType'
  | 'routeDistanceKm'
  | 'routeDurationMinutes'
  | 'timeNeededMinutes'
  | 'wayBackDistanceKm'
  | 'wayBackDurationMinutes'
>;

// The request's route (plan §3c, A78): every pickup and drop-off in order with
// when the car should get there and the drive from the stop before, then the
// totals — the route's kilometres and driving time (a round trip includes the
// way back), and the time it needs with stops and breaks. A week or month
// request has its places but no times (it isn't routed). Renders nothing for
// an older request without stops.
export function BookingRouteCard({ booking, style }: { booking: RouteBooking; style?: object }) {
  const { colors, spacing } = useTheme();
  const items = routeStopItems(booking.stops);
  if (items.length === 0) return null;

  const total = distanceTimeLabel(booking.routeDistanceKm, booking.routeDurationMinutes);
  const wayBack =
    booking.tripType === BookingTripType.ROUND_TRIP
      ? distanceTimeLabel(booking.wayBackDistanceKm, booking.wayBackDurationMinutes)
      : null;
  const needs =
    booking.timeNeededMinutes != null &&
    booking.routeDurationMinutes != null &&
    booking.timeNeededMinutes > booking.routeDurationMinutes
      ? minutesLabel(booking.timeNeededMinutes)
      : null;

  return (
    <AppCard style={style}>
      <AppText variant="label" style={{ marginBottom: spacing.sm }}>
        Route
      </AppText>
      {items.map((item, index) => {
        const color = item.kind === 'pickup' ? colors.primary : colors.text;
        return (
          <View key={item.key} style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ width: 18, alignItems: 'center' }}>
              <Ionicons name={item.kind === 'pickup' ? 'radio-button-on' : 'flag'} size={16} color={color} style={{ marginTop: 2 }} />
              {index < items.length - 1 ? (
                <View style={{ flex: 1, width: 2, marginVertical: 2, backgroundColor: colors.border }} />
              ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                <AppText variant="caption" color={color} style={{ fontFamily: 'Outfit_600SemiBold' }}>
                  {item.title}
                </AppText>
                {item.expectedAt ? (
                  <AppText muted variant="caption">
                    {stopTimeLabel(item.expectedAt, booking.requestedFromDate)}
                  </AppText>
                ) : null}
              </View>
              <AppText variant="caption">{item.place}</AppText>
              {item.note ? (
                <AppText muted variant="caption">
                  {item.note}
                </AppText>
              ) : null}
              {item.leg ? (
                <AppText muted variant="caption">
                  {item.leg} from the stop before
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}

      {total || needs ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 }}>
          {total ? (
            <AppText variant="caption">
              {total} driving{wayBack ? ', there and back' : ''}
            </AppText>
          ) : null}
          {wayBack ? (
            <AppText muted variant="caption">
              The drive back: {wayBack}
            </AppText>
          ) : null}
          {needs ? (
            <AppText muted variant="caption">
              About {needs} with stops and breaks
            </AppText>
          ) : null}
          <AppText muted variant="caption">
            Times are estimates — traffic can change them.
          </AppText>
        </View>
      ) : null}
    </AppCard>
  );
}
