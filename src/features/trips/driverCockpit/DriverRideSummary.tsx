import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AppButton, AppCard, AppInput, AppText, FormScrollView, StatusBadge } from '../../../components/ui';
import { RatingStars } from '../../../components/reviews/RatingStars';
import { useTheme } from '../../../theme';
import { normalizeApiError } from '../../../api/errors';
import type { TripManifest } from '../../../api/trips.api';
import type { TripDetail } from '../../../types/api.types';
import { currencyForMarket } from '../../../constants/markets';
import { formatDate, formatPrice } from '../../../utils/format';
import { useCreateReview, useMyEligibleReviews } from '../../reviews/queries';
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
}

// Ratings left on this screen, by tripInquiryId.
type RatingDraft = { stars: number; comment: string };

// What the driver sees once their ride has ended, in place of the map and
// leg panel: how it went, and a private rating for each rider (optional —
// riders never see these). Close saves any ratings given, then goes home.
export function DriverRideSummary({ trip, manifest, manifestFailed, onRetryManifest, riders }: DriverRideSummaryProps) {
  const { colors, spacing } = useTheme();
  const eligible = useMyEligibleReviews();
  const createReview = useCreateReview();
  const [drafts, setDrafts] = useState<Record<string, RatingDraft>>({});
  // Saved on this screen — shown as rated even once the server no longer
  // lists them as ratable.
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Read once: whether the trip's scheduled departure is still ahead — the
  // server only takes ratings after it.
  const [beforeDeparture] = useState(() => new Date(trip.departureAt).getTime() > Date.now());

  const summary = summarizeRide(riders);
  const currency = currencyForMarket(trip.userVehicle.country);
  // Backend Decimal — a string over JSON.
  const pricePerSeat = Number(trip.pricePerSeat);
  const earnings = Number.isFinite(pricePerSeat) ? formatPrice(pricePerSeat * summary.seats, currency) : '—';

  // The server's own list of riders on this trip the driver can still rate:
  // accepted, not a no-show, departed, and not rated before.
  const ratableIds = new Set(
    (eligible.data?.tripsAsDriver ?? []).filter((entry) => entry.trip.id === trip.id).map((entry) => entry.id),
  );
  // The no-show check is repeated here because that list may be cached from
  // before a rider was marked one mid-ride.
  const canRate = ({ rider, outcome }: RideSummaryRider) =>
    outcome === 'completed' && ratableIds.has(rider.id) && !savedIds.has(rider.id);
  const toSave = summary.riders.filter((entry) => canRate(entry) && (drafts[entry.rider.id]?.stars ?? 0) > 0);

  const goHome = () => router.dismissTo('/');

  // One review per rider (each is its own trip request). A 409 means it was
  // rated already — as good as saved. Stops at the first other failure,
  // keeping what did save, so a retry only sends the rest.
  const handleClose = async () => {
    if (toSave.length === 0) {
      goHome();
      return;
    }
    setSaving(true);
    setSaveError(null);
    const saved = new Set(savedIds);
    for (const { rider } of toSave) {
      const draft = drafts[rider.id];
      try {
        await createReview.mutateAsync({
          context: 'TRIP_INQUIRY',
          contextId: rider.id,
          entries: [
            { subjectType: 'USER', subjectId: rider.user.id, rating: draft.stars, comment: draft.comment.trim() || undefined },
          ],
        });
        saved.add(rider.id);
      } catch (error) {
        const apiError = normalizeApiError(error);
        if (apiError.kind === 'conflict') {
          saved.add(rider.id);
          continue;
        }
        setSavedIds(saved);
        setSaveError(`Couldn't save your rating for ${rider.user.name}: ${apiError.message}`);
        setSaving(false);
        return;
      }
    }
    setSavedIds(saved);
    setSaving(false);
    goHome();
  };

  const setDraft = (riderId: string, patch: Partial<RatingDraft>) =>
    setDrafts((prev) => {
      const current: RatingDraft = prev[riderId] ?? { stars: 0, comment: '' };
      return { ...prev, [riderId]: { ...current, ...patch } };
    });

  const ratingNote = (entry: RideSummaryRider): string | null => {
    if (entry.outcome === 'noShow') return 'Marked as a no-show — nothing to rate.';
    if (savedIds.has(entry.rider.id) || ratableIds.has(entry.rider.id)) return null;
    if (eligible.isLoading) return 'Loading…';
    if (beforeDeparture) return "You can rate riders once the trip's scheduled departure time has passed.";
    return 'Already rated.';
  };

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
                <AppText variant="subtitle">Rate your riders</AppText>
                <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
                  Optional, and private — riders never see your ratings.
                </AppText>
                <View style={{ gap: spacing.md }}>
                  {summary.riders.map((entry) => (
                    <RiderRatingCard
                      key={entry.rider.id}
                      entry={entry}
                      draft={drafts[entry.rider.id]}
                      ratable={canRate(entry)}
                      saved={savedIds.has(entry.rider.id)}
                      note={ratingNote(entry)}
                      onChange={(patch) => setDraft(entry.rider.id, patch)}
                    />
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
        {saveError ? (
          <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.sm }}>
            {saveError}
          </AppText>
        ) : null}
        <AppButton
          title={
            toSave.length === 0
              ? 'Close'
              : `Save ${toSave.length === 1 ? 'rating' : `${toSave.length} ratings`} & close`
          }
          loading={saving}
          onPress={handleClose}
        />
        {saveError ? (
          <AppButton
            title="Close without saving"
            variant="ghost"
            onPress={goHome}
            style={{ marginTop: spacing.xs }}
          />
        ) : null}
      </View>
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

interface RiderRatingCardProps {
  entry: RideSummaryRider;
  draft: RatingDraft | undefined;
  // Can still be rated here (and hasn't been saved yet).
  ratable: boolean;
  saved: boolean;
  // Why there's nothing to rate, when there isn't.
  note: string | null;
  onChange: (patch: Partial<RatingDraft>) => void;
}

function RiderRatingCard({ entry, draft, ratable, saved, note, onChange }: RiderRatingCardProps) {
  const { spacing } = useTheme();
  const { rider, outcome } = entry;
  const stars = draft?.stars ?? 0;

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

      {ratable ? (
        <View style={{ marginTop: spacing.md }}>
          <RatingStars value={stars} onChange={(value) => onChange({ stars: value })} size="lg" />
          {stars > 0 ? (
            <AppInput
              style={{ marginTop: spacing.sm, marginBottom: 0 }}
              multiline
              numberOfLines={2}
              maxLength={1000}
              placeholder="Add a private note (optional)"
              value={draft?.comment ?? ''}
              onChangeText={(text) => onChange({ comment: text })}
            />
          ) : null}
        </View>
      ) : saved ? (
        <View style={{ marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <RatingStars value={stars} size="sm" />
          <AppText muted variant="caption">
            Rating saved
          </AppText>
        </View>
      ) : note ? (
        <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
          {note}
        </AppText>
      ) : null}
    </AppCard>
  );
}
