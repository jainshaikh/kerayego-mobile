import { View } from 'react-native';
import { AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { PickupSource, TripStatus } from '../../../types/enums';
import { formatTripTime, tripTimeZoneSuffix } from '../../../utils/tripDateTime';
import { DriverContactActions } from './DriverContactActions';
import type { RiderSeatStage } from './riderTripState';
import { driverCallNumber, ownDropoffPoint } from './tripDisplay';

export type SeatOutcomeStage = Exclude<RiderSeatStage, 'request' | 'upcoming' | 'live'>;

interface SeatOutcomeCardProps {
  stage: SeatOutcomeStage;
  inquiry: TripInquiry;
  // In-app chat with the driver — offered to a no-show rider only while the
  // trip is still running (chat is a live-ride feature).
  onOpenChat?: () => void;
}

// How a confirmed seat ended up when it's no longer live or upcoming: the
// rider's own drop-off (the trip may still be running for the others), a
// no-show mark from the driver, or the trip itself ending, being called off
// or suspended without anything recorded for this rider. Nothing here is a
// live action — only next steps and ways to reach the driver. Rating the
// ride is the RatePromptCard below it (RiderPreLiveView), while it's unrated.
export function SeatOutcomeCard({ stage, inquiry, onOpenChat }: SeatOutcomeCardProps) {
  const { colors, spacing } = useTheme();
  const { trip } = inquiry;
  const driverName = trip.postedBy.name;
  const callNumber = driverCallNumber(trip);
  const zone = tripTimeZoneSuffix();

  if (stage === 'droppedOff') {
    // Riders the driver never tapped are dropped off automatically when the
    // trip ends — that's the trip ending, not this rider arriving.
    const auto = inquiry.pickupSource === PickupSource.AUTO_ON_TRIP_END;
    const at = inquiry.droppedOffAt ? `${formatTripTime(inquiry.droppedOffAt)}${zone}` : null;
    return (
      <AppCard style={{ marginTop: spacing.lg, borderColor: colors.complete }}>
        <AppText variant="subtitle" color={colors.complete}>
          {auto ? 'Trip completed' : "You've arrived"}
        </AppText>
        <AppText muted style={{ marginTop: spacing.xs }}>
          {auto
            ? `${driverName} ended the trip${at ? ` at ${at}` : ''}.`
            : `Dropped off at ${ownDropoffPoint(inquiry).label}${at ? ` · ${at}` : ''}.`}{' '}
          Thanks for riding with {driverName}.
        </AppText>
        {callNumber || trip.contactNumber ? (
          <>
            <AppText muted variant="caption" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
              Left something behind? Contact {driverName}.
            </AppText>
            <DriverContactActions callNumber={callNumber} whatsappNumber={trip.contactNumber} />
          </>
        ) : null}
      </AppCard>
    );
  }

  if (stage === 'noShow') {
    const tripRunning = trip.status === TripStatus.IN_PROGRESS;
    const at = inquiry.noShowAt ? ` at ${formatTripTime(inquiry.noShowAt)}${zone}` : '';
    return (
      <AppCard style={{ marginTop: spacing.lg, borderColor: colors.danger }}>
        <AppText variant="subtitle" color={colors.danger}>
          Marked as no-show
        </AppText>
        <AppText muted style={{ marginTop: spacing.xs }}>
          {driverName} marked you as not at the pickup point{at}.
        </AppText>
        <AppText muted style={{ marginTop: spacing.sm, marginBottom: spacing.md }}>
          {tripRunning
            ? 'If this is a mistake, contact them now — if they pick you up after all, your live ride carries on here.'
            : 'This trip has ended. If this was a mistake, contact your driver.'}
        </AppText>
        <DriverContactActions
          callNumber={callNumber}
          whatsappNumber={trip.contactNumber}
          onOpenChat={tripRunning ? onOpenChat : undefined}
        />
      </AppCard>
    );
  }

  const copy: Record<Exclude<SeatOutcomeStage, 'droppedOff' | 'noShow'>, { title: string; body: string }> = {
    tripCompleted: { title: 'Trip completed', body: `${driverName} has ended this trip.` },
    tripCancelled: { title: 'Trip cancelled', body: 'This trip was cancelled, so your seat is no longer booked.' },
    tripSuspended: {
      title: 'Trip suspended',
      body: `KerayeGo has suspended this trip, so it won't run as planned. Contact ${driverName} or look for another ride.`,
    },
    tripUnavailable: { title: 'Trip unavailable', body: "This trip isn't running right now." },
  };
  const { title, body } = copy[stage];

  return (
    <AppCard style={{ marginTop: spacing.lg }}>
      <AppText variant="subtitle">{title}</AppText>
      <AppText muted style={{ marginTop: spacing.xs }}>
        {body}
      </AppText>
      {stage === 'tripSuspended' ? (
        <View style={{ marginTop: spacing.md }}>
          <DriverContactActions callNumber={callNumber} whatsappNumber={trip.contactNumber} />
        </View>
      ) : null}
    </AppCard>
  );
}
