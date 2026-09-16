import { ScrollView, View } from 'react-native';
import { AppCard, AppText, DetailRow } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { formatDate, formatPrice, titleCase } from '../../../utils/format';
import type { RiderStop } from './useRiderLiveRoute';

interface SummaryTabProps {
  inquiry: TripInquiry;
  pickupStop: RiderStop | null;
  dropoffStop: RiderStop | null;
}

// Summary tab of the rider's live view: a read-only recap of the booking
// (route, seat, pickup/dropoff, booked date) and a fare estimate.
export function SummaryTab({ inquiry, pickupStop, dropoffStop }: SummaryTabProps) {
  const { colors, spacing } = useTheme();

  const pricePerSeatNum =
    typeof inquiry.trip.pricePerSeat === 'string' ? parseFloat(inquiry.trip.pricePerSeat) : (inquiry.trip.pricePerSeat as number);
  const fareEstimate = Number.isFinite(pricePerSeatNum) ? pricePerSeatNum * inquiry.requestedSeats : 0;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ gap: spacing.md }}>
        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Ride summary
          </AppText>
          <View style={{ gap: spacing.md }}>
            <DetailRow label="Route" value={`${titleCase(inquiry.trip.originCity)} → ${titleCase(inquiry.trip.destinationCity)}`} />
            <DetailRow label="Your seat" value={`${inquiry.requestedSeats} seat${inquiry.requestedSeats !== 1 ? 's' : ''}`} />
            <DetailRow label="Pickup" value={pickupStop?.label ?? '—'} />
            <DetailRow label="Dropoff" value={dropoffStop?.label ?? '—'} />
            <DetailRow label="Booked" value={formatDate(inquiry.createdAt)} />
          </View>
        </AppCard>

        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Fare
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
            <AppText variant="title" color={colors.primary}>
              {formatPrice(fareEstimate)}
            </AppText>
            <AppText muted variant="caption">
              / {inquiry.requestedSeats} seat{inquiry.requestedSeats !== 1 ? 's' : ''}
            </AppText>
          </View>
          <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
            Estimate only — paid to the driver directly.
          </AppText>
        </AppCard>
      </View>
    </ScrollView>
  );
}
