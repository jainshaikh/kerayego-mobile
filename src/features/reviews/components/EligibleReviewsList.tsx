import { useState } from 'react';
import { View } from 'react-native';

import { useMyEligibleReviews, useCreateReview } from '../queries';
import type { ReviewContext, ReviewSubjectType } from '../../../api/reviews.api';
import { RatingStars } from '../../../components/reviews/RatingStars';
import { AppButton, AppCard, AppInput, AppSheet, AppText, EmptyState, LoadingState } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { normalizeApiError } from '../../../api/errors';

interface RateTarget {
  subjectType: ReviewSubjectType;
  subjectId: string;
  label: string;
}

interface PendingRating {
  context: ReviewContext;
  contextId: string;
  title: string;
  targets: RateTarget[];
}

function RateModal({ pending, onClose }: { pending: PendingRating | null; onClose: () => void }) {
  const { colors, spacing } = useTheme();
  const createReview = useCreateReview();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const close = () => {
    setRatings({});
    setComments({});
    setSubmitError(null);
    onClose();
  };

  if (!pending) return null;

  const allRated = pending.targets.every((t) => (ratings[t.subjectId] ?? 0) > 0);

  const handleSubmit = async () => {
    setSubmitError(null);
    const entries = pending.targets.map((t) => ({
      subjectType: t.subjectType,
      subjectId: t.subjectId,
      rating: ratings[t.subjectId] ?? 0,
      comment: comments[t.subjectId]?.trim() || undefined,
    }));
    try {
      await createReview.mutateAsync({ context: pending.context, contextId: pending.contextId, entries });
      close();
    } catch (error) {
      setSubmitError(normalizeApiError(error).message);
    }
  };

  return (
    <AppSheet visible={!!pending} onClose={close} title={pending.title}>
      {pending.targets.map((t) => (
        <View key={t.subjectId} style={{ marginBottom: spacing.lg }}>
          <AppText variant="label" style={{ marginBottom: spacing.xs }}>
            {t.label}
          </AppText>
          <RatingStars value={ratings[t.subjectId] ?? 0} onChange={(v) => setRatings((r) => ({ ...r, [t.subjectId]: v }))} size="lg" />
          <AppInput
            style={{ marginTop: spacing.sm, marginBottom: 0 }}
            multiline
            numberOfLines={2}
            placeholder="Add a comment (optional)"
            value={comments[t.subjectId] ?? ''}
            onChangeText={(text) => setComments((c) => ({ ...c, [t.subjectId]: text }))}
          />
        </View>
      ))}

      {submitError ? (
        <AppText color={colors.danger} style={{ marginBottom: spacing.md }}>
          {submitError}
        </AppText>
      ) : null}

      <AppButton
        title="Submit rating"
        disabled={!allRated}
        loading={createReview.isPending}
        onPress={handleSubmit}
      />
    </AppSheet>
  );
}

// Shared entry point for anything the current user can now rate — a completed
// vehicle rental (as the customer) or a departed carpool trip (as rider or
// driver). Mobile has no provider role, so bookingsAsProvider will typically
// be empty here, but it's rendered the same way as the others in case a
// provider-role account ever ends up with data in it.
export function EligibleReviewsList() {
  const { data, isLoading } = useMyEligibleReviews();
  const [pending, setPending] = useState<PendingRating | null>(null);

  if (isLoading) return <LoadingState label="Loading..." />;

  const hasAny =
    data &&
    (data.bookingsAsCustomer.length > 0 ||
      data.bookingsAsProvider.length > 0 ||
      data.tripsAsRider.length > 0 ||
      data.tripsAsDriver.length > 0);

  if (!hasAny) {
    return (
      <EmptyState
        title="Nothing to rate right now"
        description="Completed rentals and departed trips you haven't rated yet will show up here."
      />
    );
  }

  return (
    <View>
      {data!.bookingsAsCustomer.length > 0 ? (
        <Section title="Rentals you can rate">
          {data!.bookingsAsCustomer.map((b) => (
            <Row
              key={b.id}
              label={b.vehicle?.title ?? 'Vehicle rental'}
              onRate={() =>
                setPending({
                  context: 'BOOKING_REQUEST',
                  contextId: b.id,
                  title: `Rate: ${b.vehicle?.title ?? 'your rental'}`,
                  targets: [
                    { subjectType: 'VEHICLE', subjectId: b.vehicle!.id, label: 'The vehicle' },
                    { subjectType: 'PROVIDER', subjectId: b.providerProfileId!, label: 'The provider' },
                  ],
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {data!.bookingsAsProvider.length > 0 ? (
        <Section title="Customers you can rate" note="Private — never shown publicly">
          {data!.bookingsAsProvider.map((b) => (
            <Row
              key={b.id}
              label={b.user?.name ?? 'Customer'}
              onRate={() =>
                setPending({
                  context: 'BOOKING_REQUEST',
                  contextId: b.id,
                  title: `Rate customer: ${b.user?.name ?? ''}`,
                  targets: [{ subjectType: 'USER', subjectId: b.user!.id, label: 'The customer' }],
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {data!.tripsAsRider.length > 0 ? (
        <Section title="Trips you can rate">
          {data!.tripsAsRider.map((t) => (
            <Row
              key={t.id}
              label={`${t.trip.originCity} → ${t.trip.destinationCity}`}
              onRate={() =>
                setPending({
                  context: 'TRIP_INQUIRY',
                  contextId: t.id,
                  title: `Rate your trip: ${t.trip.originCity} → ${t.trip.destinationCity}`,
                  targets: [
                    { subjectType: 'USER_VEHICLE', subjectId: t.trip.userVehicleId!, label: 'The vehicle' },
                    { subjectType: 'USER', subjectId: t.trip.postedByUserId!, label: 'The driver' },
                  ],
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {data!.tripsAsDriver.length > 0 ? (
        <Section title="Riders you can rate" note="Private — never shown publicly">
          {data!.tripsAsDriver.map((t) => (
            <Row
              key={t.id}
              label={t.user?.name ?? 'Rider'}
              onRate={() =>
                setPending({
                  context: 'TRIP_INQUIRY',
                  contextId: t.id,
                  title: `Rate rider: ${t.user?.name ?? ''}`,
                  targets: [{ subjectType: 'USER', subjectId: t.user!.id, label: 'The rider' }],
                })
              }
            />
          ))}
        </Section>
      ) : null}

      <RateModal pending={pending} onClose={() => setPending(null)} />
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
