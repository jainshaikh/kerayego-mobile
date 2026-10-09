import { ScrollView, View } from 'react-native';
import { AppCard, AppText, DetailRow } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripManifest } from '../../../api/trips.api';
import type { TripDetail } from '../../../types/api.types';
import { formatDate, formatPrice, titleCase } from '../../../utils/format';
import type { CockpitRider } from './stopProgress';

interface DetailsTabProps {
  trip: TripDetail;
  manifest: TripManifest | undefined;
  riders: CockpitRider[];
}

// Details tab (design spec §4.3) — exactly three text-only Cards, computed
// from data already on the manifest/trip; distance is intentionally omitted
// (TripDetail has no real distance field to report here).
export function DetailsTab({ trip, manifest, riders }: DetailsTabProps) {
  const { colors, spacing } = useTheme();

  const pickupStopsCount = (manifest?.routeStops ?? []).filter((s) => s.type === 'PICKUP').length;
  const dropoffStopsCount = (manifest?.routeStops ?? []).length - pickupStopsCount;
  // A no-show didn't ride, so their seats earn nothing — they're counted
  // separately instead.
  const noShowCount = riders.filter((r) => r.noShow).length;
  const totalSeats = riders.filter((r) => !r.noShow).reduce((sum, r) => sum + r.requestedSeats, 0);
  const pricePerSeatNum =
    typeof trip.pricePerSeat === 'string' ? parseFloat(trip.pricePerSeat) : (trip.pricePerSeat as number);
  const earningsEstimate = Number.isFinite(pricePerSeatNum) ? pricePerSeatNum * totalSeats : 0;
  // TripDetail carries no "actual start" timestamp (only the scheduled
  // departureAt) — the trip's scheduled departure is the closest real,
  // non-fabricated stand-in for it.
  const startedLabel = formatDate(trip.departureAt);

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ gap: spacing.md }}>
        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Trip summary
          </AppText>
          <View style={{ gap: spacing.md }}>
            <DetailRow label="Route" value={`${trip.originCity} → ${trip.destinationCity}`} />
            <DetailRow label="Started" value={startedLabel} />
            <DetailRow label="Stops" value={`${pickupStopsCount} pickups · ${dropoffStopsCount} dropoffs`} />
            <DetailRow
              label="Riders"
              value={`${riders.length} riders · ${totalSeats} seats${noShowCount > 0 ? ` · ${noShowCount} no-show` : ''}`}
            />
          </View>
        </AppCard>

        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Vehicle
          </AppText>
          <View style={{ gap: spacing.md }}>
            <DetailRow label="Vehicle" value={`${titleCase(trip.userVehicle.make)} ${titleCase(trip.userVehicle.model)}`} />
            <DetailRow label="Plate" value={trip.userVehicle.plateNumber} />
            <DetailRow label="Seats offered" value={String(trip.availableSeats)} />
          </View>
        </AppCard>

        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Earnings
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
            <AppText variant="title" color={colors.primary}>
              {formatPrice(earningsEstimate)}
            </AppText>
            <AppText muted variant="caption">
              / {totalSeats} seat{totalSeats !== 1 ? 's' : ''}
            </AppText>
          </View>
          <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
            Estimate only — collected from riders directly.
          </AppText>
        </AppCard>
      </View>
    </ScrollView>
  );
}
