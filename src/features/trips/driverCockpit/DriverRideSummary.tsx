import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AppButton, AppCard, AppText, FormScrollView, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripManifest } from '../../../api/trips.api';
import type { TripDetail } from '../../../types/api.types';
import { TripStatus } from '../../../types/enums';
import { currencyForMarket } from '../../../constants/markets';
import { formatDate, formatPrice } from '../../../utils/format';
import { useRatingPrompt } from '../../reviews/useRatingPrompt';
import { driverTripPendingRatings } from '../../reviews/ratingPrompt';
import { RateSheet } from '../../reviews/components/RateSheet';
import { RatePromptCard } from '../../reviews/components/RatePromptCard';
import { RideAvatar } from '../../liveRide/components/RideAvatar';
import { summarizeRide, type RideSummaryRider } from './rideSummary';
import type { CockpitRider } from './stopProgress';

interface DriverRideSummaryProps {
  trip: TripDetail;
  manifest: TripManifest | undefined;
  manifestFailed: boolean;
  onRetryManifest: () => void;
  // The manifest's riders with the driver's own unsynced taps merged in.
  riders: CockpitRider[];
  // Another sheet is open on the screen (a chat push's notice) — the rating
  // sheet waits for it.
  otherSheetOpen: boolean;
}

// What the driver sees once their ride has ended, in place of the map and
// leg panel: how it went, and — once the server has the trip completed — a
// "Rate your riders" sheet that opens on its own (once per trip on this
// device) plus a card to reopen it while any rider is unrated. Ratings are
// optional and private: riders never see them.
export function DriverRideSummary({
  trip,
  manifest,
  manifestFailed,
  onRetryManifest,
  riders,
  otherSheetOpen,
}: DriverRideSummaryProps) {
  const { colors, spacing } = useTheme();
  // Read once: whether the trip's scheduled departure is still ahead — the
  // server only takes ratings after it.
  const [beforeDeparture] = useState(() => new Date(trip.departureAt).getTime() > Date.now());
  // Not an End still waiting in the offline queue: the server only lists the
  // trip's riders as ratable once it has the trip completed.
  const serverCompleted = trip.status === TripStatus.COMPLETED;
  // Riders this device knows were marked a no-show since the eligible list
  // was fetched (the server leaves no-shows out itself).
  const noShowIds = riders.filter((rider) => rider.noShow).map((rider) => rider.id);
  const rating = useRatingPrompt({
    context: 'tripDriver',
    id: trip.id,
    rideOver: serverCompleted,
    pick: (eligible) => driverTripPendingRatings(eligible, trip.id, noShowIds),
    otherSheetOpen,
  });

  const summary = summarizeRide(riders);
  // A return trip has no userVehicle (it runs in a fleet car).
  const currency = currencyForMarket(trip.userVehicle?.country);
  // Backend Decimal — a string over JSON.
  const pricePerSeat = Number(trip.pricePerSeat);
  const earnings = Number.isFinite(pricePerSeat) ? formatPrice(pricePerSeat * summary.seats, currency) : '—';

  const goHome = () => router.dismissTo('/');
  const pendingCount = serverCompleted ? rating.pendings.length : 0;
  // Why there's no rating card for riders who did travel.
  const ratingNote = !serverCompleted
    ? 'You can rate your riders once your trip end has synced.'
    : beforeDeparture && pendingCount === 0
      ? "You can rate riders once the trip's scheduled departure time has passed — from Profile → Reviews."
      : null;

  return (
    <View style={{ flex: 1 }}>
      <FormScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
          <Ionicons name="checkmark-circle" size={56} color={colors.success} />
          <AppText variant="title" style={{ marginTop: spacing.sm }}>
            Ride completed
          </AppText>
          <AppText muted style={{ marginTop: spacing.xs, textTransform: 'capitalize', textAlign: 'center' }}>
            {trip.originCity} → {trip.destinationCity}
          </AppText>
          <AppText muted variant="caption">
            {formatDate(trip.departureAt)}
          </AppText>
        </View>

        {/* Until every rider is rated — the way back into the sheet. */}
        {pendingCount > 0 ? (
          <RatePromptCard
            title="Rate your riders"
            body={`${pendingCount} rider${pendingCount !== 1 ? 's' : ''} to rate · private, riders never see it`}
            onRate={rating.openSheet}
            style={{ marginBottom: spacing.lg }}
          />
        ) : null}

        {!manifest ? (
          manifestFailed ? (
            <AppCard style={{ gap: spacing.sm }}>
              <AppText>Couldn&apos;t load your riders.</AppText>
              <AppButton title="Try again" variant="secondary" onPress={onRetryManifest} />
            </AppCard>
          ) : (
            <AppText muted style={{ textAlign: 'center' }}>
              Loading your ride…
            </AppText>
          )
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
              <Stat label="Riders" value={String(summary.completedCount)} />
              <Stat label="Seats" value={String(summary.seats)} />
              <Stat label="No-shows" value={String(summary.noShowCount)} />
            </View>
            <AppCard style={{ marginBottom: spacing.xl }}>
              <AppText muted variant="caption">
                Estimated earnings
              </AppText>
              <AppText variant="title" color={colors.primary}>
                {earnings}
              </AppText>
              <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                {summary.seats} seat{summary.seats !== 1 ? 's' : ''} — collected from riders directly.
              </AppText>
            </AppCard>

            {summary.riders.length > 0 ? (
              <>
                {pendingCount === 0 && summary.completedCount > 0 && ratingNote ? (
                  <AppText muted variant="caption" style={{ marginBottom: spacing.lg }}>
                    {ratingNote}
                  </AppText>
                ) : null}
                <AppText variant="subtitle" style={{ marginBottom: spacing.md }}>
                  Your riders
                </AppText>
                <View style={{ gap: spacing.md }}>
                  {summary.riders.map((entry) => (
                    <RiderSummaryCard key={entry.rider.id} entry={entry} />
                  ))}
                </View>
              </>
            ) : (
              <AppText muted style={{ textAlign: 'center' }}>
                No riders travelled on this trip.
              </AppText>
            )}
          </>
        )}
      </FormScrollView>

      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.background,
        }}
      >
        <AppButton title="Close" onPress={goHome} />
      </View>

      <RateSheet
        visible={rating.sheetOpen}
        pendings={rating.pendings}
        title="Rate your riders"
        subtitle={`${trip.originCity} → ${trip.destinationCity}`}
        note="Optional, and private — riders never see your ratings."
        dismissLabel="Later"
        onClose={rating.closeSheet}
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { spacing } = useTheme();
  return (
    <AppCard style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.sm }}>
      <AppText variant="title">{value}</AppText>
      <AppText muted variant="caption">
        {label}
      </AppText>
    </AppCard>
  );
}

function RiderSummaryCard({ entry }: { entry: RideSummaryRider }) {
  const { spacing } = useTheme();
  const { rider, outcome } = entry;

  return (
    <AppCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <RideAvatar name={rider.user.name} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label" numberOfLines={1}>
            {rider.user.name}
          </AppText>
          <AppText muted variant="caption" numberOfLines={1}>
            {rider.requestedSeats} seat{rider.requestedSeats !== 1 ? 's' : ''} · {rider.pickupStop?.label ?? '—'} →{' '}
            {rider.dropoffStop?.label ?? '—'}
          </AppText>
        </View>
        <StatusBadge
          label={outcome === 'noShow' ? 'No-show' : 'Completed'}
          tone={outcome === 'noShow' ? 'danger' : 'complete'}
        />
      </View>
    </AppCard>
  );
}
