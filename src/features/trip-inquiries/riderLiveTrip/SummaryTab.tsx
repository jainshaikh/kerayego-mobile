import { ScrollView, View } from 'react-native';
import { AppCard, AppText, DetailRow } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { formatDate, titleCase } from '../../../utils/format';
import { ownDropoffPoint, ownPickupPoint, seatFare, tripCurrency } from './tripDisplay';

interface SummaryTabProps {
  inquiry: TripInquiry;
}

// Summary tab of the rider's live view: a read-only recap of the booking
// (route, seat, the rider's own pickup/dropoff, booked date) and the fare,
// in the trip's own market currency.
export function SummaryTab({ inquiry }: SummaryTabProps) {
  const { colors, spacing } = useTheme();
  const fare = seatFare(inquiry.trip.pricePerSeat, inquiry.requestedSeats, tripCurrency(inquiry.trip));

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
            <DetailRow label="Pickup" value={ownPickupPoint(inquiry).label} />
            <DetailRow label="Dropoff" value={ownDropoffPoint(inquiry).label} />
            <DetailRow label="Booked" value={formatDate(inquiry.createdAt)} />
          </View>
        </AppCard>

        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Fare
          </AppText>
          <AppText variant="title" color={colors.primary}>
            {fare ? fare.total : '—'}
          </AppText>
          {fare ? (
            <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
              {fare.breakdown}
            </AppText>
          ) : null}
          <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
            Estimate only — paid to the driver directly.
          </AppText>
        </AppCard>
      </View>
    </ScrollView>
  );
}
