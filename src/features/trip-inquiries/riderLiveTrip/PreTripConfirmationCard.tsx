import { View } from 'react-native';
import { AppButton, AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { useNow } from '../../../hooks/useNow';
import { formatDepartureCountdown, formatTripDateTime, tripTimeZoneSuffix } from '../../../utils/tripDateTime';
import { mapsNavigationUrl, openMapsNavigation } from '../../liveRide/openMapsNavigation';
import { estimateServerNowMs, type ServerClock } from '../../trips/driverCockpit/noShow';
import { DriverArrivedAgo } from './DriverArrivedAgo';
import { DriverContactActions } from './DriverContactActions';
import { VehicleSummary } from './VehicleSummary';
import { driverCallNumber, ownDropoffPoint, ownPickupPoint, seatFare, tripCurrency, type OwnStopPoint } from './tripDisplay';

interface PreTripConfirmationCardProps {
  inquiry: TripInquiry;
  // From the request's serverNow — corrects the countdown for a phone whose
  // clock is off. null on an older backend (the phone's clock is used).
  serverClock: ServerClock | null;
}

// "Departs in 2 h 5 min", re-rendered on the shared clock — its own leaf so
// only this line re-renders each tick.
function DepartureCountdown({ departureAt, serverClock }: { departureAt: string; serverClock: ServerClock | null }) {
  const { spacing } = useTheme();
  const deviceNow = useNow(true);
  const now = serverClock ? estimateServerNowMs(serverClock, deviceNow) : deviceNow;
  const countdown = formatDepartureCountdown(departureAt, now);
  if (!countdown) return null;

  return (
    <View style={{ marginTop: spacing.xs }}>
      <AppText variant="title">{countdown.label}</AppText>
      {countdown.past ? (
        <AppText muted variant="caption">
          Your driver hasn&apos;t started the trip yet — this updates as soon as they do.
        </AppText>
      ) : null}
    </View>
  );
}

function Divider() {
  const { colors, spacing } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />;
}

function StopRow({ heading, point, note }: { heading: string; point: OwnStopPoint; note?: string | null }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText muted variant="caption">
          {heading}
        </AppText>
        <AppText variant="label">{point.label}</AppText>
        {note ? (
          <AppText muted variant="caption" style={{ marginTop: 2 }}>
            Your note: {note}
          </AppText>
        ) : null}
      </View>
      {mapsNavigationUrl(point) ? (
        <AppButton title="Navigate" variant="secondary" fullWidth={false} onPress={() => openMapsNavigation(point)} />
      ) : null}
    </View>
  );
}

// The confirmed rider's day-before card (seat ACCEPTED, trip not started
// yet): when they leave, where THEY get picked up and dropped off (their own
// stops, not the trip's first/last), the car to look for, what they owe, and
// how to reach the driver. No in-app chat here — chat before the trip starts
// is an open product decision.
export function PreTripConfirmationCard({ inquiry, serverClock }: PreTripConfirmationCardProps) {
  const { colors, spacing } = useTheme();
  const { trip } = inquiry;
  const fare = seatFare(trip.pricePerSeat, inquiry.requestedSeats, tripCurrency(trip));

  return (
    <AppCard style={{ marginTop: spacing.lg, borderColor: colors.success }}>
      <AppText variant="label" color={colors.success}>
        Seat confirmed
      </AppText>
      <DepartureCountdown departureAt={trip.departureAt} serverClock={serverClock} />
      <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
        {formatTripDateTime(trip.departureAt)}
        {tripTimeZoneSuffix()}
      </AppText>
      <DriverArrivedAgo
        arrivedAt={inquiry.pickupStop?.arrivedAt}
        serverClock={serverClock}
        visible
        style={{ marginTop: spacing.sm }}
      />

      <Divider />
      <View style={{ gap: spacing.md }}>
        <StopRow heading="Your pickup" point={ownPickupPoint(inquiry)} note={inquiry.pickupNote} />
        <StopRow heading="Your drop-off" point={ownDropoffPoint(inquiry)} />
      </View>

      <Divider />
      <AppText muted variant="caption" style={{ marginBottom: spacing.sm }}>
        Vehicle
      </AppText>
      <VehicleSummary vehicle={trip.userVehicle} />

      {fare ? (
        <>
          <Divider />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText muted variant="caption">
                Fare
              </AppText>
              <AppText variant="caption">{fare.breakdown}</AppText>
            </View>
            <AppText variant="subtitle" color={colors.primary}>
              {fare.total}
            </AppText>
          </View>
          <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
            Paid to the driver directly.
          </AppText>
        </>
      ) : null}

      <Divider />
      <AppText muted variant="caption">
        Your driver
      </AppText>
      <AppText variant="label" style={{ marginBottom: spacing.sm }}>
        {trip.postedBy.name}
      </AppText>
      <DriverContactActions callNumber={driverCallNumber(trip)} whatsappNumber={trip.contactNumber} />
    </AppCard>
  );
}
