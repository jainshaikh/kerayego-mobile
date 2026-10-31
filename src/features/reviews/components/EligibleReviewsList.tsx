import { useState } from 'react';
import { View } from 'react-native';

import { useMyEligibleReviews } from '../queries';
import { AppButton, AppCard, AppText, EmptyState, LoadingState } from '../../../components/ui';
import { useTheme } from '../../../theme';
import {
  bookingDriverName,
  customerBookingRating,
  driverTripRating,
  providerBookingRating,
  riderTripRating,
  type PendingRating,
} from '../rateTargets';
import { RateSheet } from './RateSheet';

// Shared entry point for anything the current user can now rate — a completed
// vehicle rental (as the customer: the car and, when there was one, the
// driver — never the business, A18) or a departed carpool trip (as rider: the
// car and the driver; as driver: the rider). Mobile has no provider role, so
// bookingsAsProvider will typically be empty here, but it's rendered the same
// way as the others in case a provider-role account ever ends up with data
// in it. A row the backend sent too little to rate is left out.
export function EligibleReviewsList() {
  const { data, isLoading } = useMyEligibleReviews();
  const [pending, setPending] = useState<PendingRating | null>(null);

  if (isLoading) return <LoadingState label="Loading..." />;

  const customerBookings = (data?.bookingsAsCustomer ?? []).flatMap((b) => {
    const rating = customerBookingRating(b);
    if (!rating) return [];
    const driver = bookingDriverName(b);
    const label = `${b.vehicle?.title ?? 'Vehicle rental'}${driver ? ` · ${driver}` : ''}`;
    return [{ id: b.id, label, rating }];
  });
  const providerBookings = (data?.bookingsAsProvider ?? []).flatMap((b) => {
    const rating = providerBookingRating(b);
    return rating ? [{ id: b.id, label: b.user?.name ?? 'Customer', rating }] : [];
  });
  const riderTrips = (data?.tripsAsRider ?? []).flatMap((t) => {
    const rating = riderTripRating(t);
    return rating ? [{ id: t.id, label: `${t.trip.originCity} → ${t.trip.destinationCity}`, rating }] : [];
  });
  const driverTrips = (data?.tripsAsDriver ?? []).flatMap((t) => {
    const rating = driverTripRating(t);
    return rating ? [{ id: t.id, label: t.user?.name ?? 'Rider', rating }] : [];
  });

  const hasAny = customerBookings.length + providerBookings.length + riderTrips.length + driverTrips.length > 0;

  return (
    <View>
      {!hasAny ? (
        <EmptyState
          title="Nothing to rate right now"
          description="Completed rentals and departed trips you haven't rated yet will show up here."
        />
      ) : null}

      {customerBookings.length > 0 ? (
        <Section title="Rentals you can rate">
          {customerBookings.map((row) => (
            <Row key={row.id} label={row.label} onRate={() => setPending(row.rating)} />
          ))}
        </Section>
      ) : null}

      {providerBookings.length > 0 ? (
        <Section title="Customers you can rate" note="Private — never shown publicly">
          {providerBookings.map((row) => (
            <Row key={row.id} label={row.label} onRate={() => setPending(row.rating)} />
          ))}
        </Section>
      ) : null}

      {riderTrips.length > 0 ? (
        <Section title="Trips you can rate">
          {riderTrips.map((row) => (
            <Row key={row.id} label={row.label} onRate={() => setPending(row.rating)} />
          ))}
        </Section>
      ) : null}

      {driverTrips.length > 0 ? (
        <Section title="Riders you can rate" note="Private — never shown publicly">
          {driverTrips.map((row) => (
            <Row key={row.id} label={row.label} onRate={() => setPending(row.rating)} />
          ))}
        </Section>
      ) : null}

      {/* Stays mounted as the list empties out once the last row is rated,
          so its thank-you isn't cut short. */}
      <RateSheet
        visible={!!pending}
        pendings={pending ? [pending] : []}
        title={pending?.title ?? ''}
        onClose={() => setPending(null)}
      />
    </View>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginBottom: spacing.sm }}>
        <AppText variant="label">{title}</AppText>
        {note ? (
          <AppText muted variant="caption">
            {note}
          </AppText>
        ) : null}
      </View>
      <View style={{ gap: spacing.sm }}>{children}</View>
    </View>
  );
}

function Row({ label, onRate }: { label: string; onRate: () => void }) {
  const { spacing } = useTheme();
  return (
    <AppCard style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <AppText variant="caption" style={{ flex: 1, marginRight: spacing.sm }} numberOfLines={1}>
        {label}
      </AppText>
      <AppButton title="Rate" variant="secondary" fullWidth={false} onPress={onRate} />
    </AppCard>
  );
}
