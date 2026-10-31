import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useCreateReview } from '../queries';
import { RatingStars } from '../../../components/reviews/RatingStars';
import { AppButton, AppInput, AppSheet, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { normalizeApiError } from '../../../api/errors';
import { MAX_REVIEW_COMMENT_LENGTH, targetKey, type PendingRating } from '../rateTargets';
import { buildReviewPayloads, type CommentsByContext, type RatingsByContext } from '../ratingPrompt';

// How long the thank-you shows before the sheet closes on its own.
const THANK_YOU_MS = 1800;

interface RateSheetProps {
  visible: boolean;
  // What to rate. Usually one ride (a rental, a carpool seat — every target
  // in it is required, see buildReviewPayload); a driver's sheet holds one
  // per rider, each optional and sent as its own POST.
  pendings: PendingRating[];
  title: string;
  subtitle?: string;
  // Shown under the title, e.g. that ratings are private.
  note?: string;
  // A secondary "not now" button (the end-of-ride prompt's "Later").
  dismissLabel?: string;
  onClose: () => void;
}

interface Snapshot {
  pendings: PendingRating[];
  title: string;
  subtitle?: string;
  note?: string;
}

// The app's one rating sheet — Profile → Reviews and the end-of-ride prompts
// (carpool driver and rider, rental customer) all use it. What it asks comes
// from features/reviews/rateTargets.ts. A 409 ("already rated", e.g. from
// another device) counts as saved. After saving it thanks the user and
// closes; the eligible list refreshes through useCreateReview.
export function RateSheet({ visible, pendings, title, subtitle, note, dismissLabel, onClose }: RateSheetProps) {
  const { colors, spacing } = useTheme();
  const createReview = useCreateReview();
  // Taken as the sheet opens, so rows don't vanish under the user while the
  // eligible list refetches after each save.
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [wasVisible, setWasVisible] = useState(false);
  const [ratings, setRatings] = useState<RatingsByContext>({});
  const [comments, setComments] = useState<CommentsByContext>({});
  // contextIds saved from this sheet (kept when a later one fails).
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setSnapshot({ pendings, title, subtitle, note });
      setRatings({});
      setComments({});
      setSavedIds(new Set());
      setSubmitError(null);
      setDone(false);
    }
  }

  useEffect(() => {
    if (!done || !visible) return;
    const timer = setTimeout(onClose, THANK_YOU_MS);
    return () => clearTimeout(timer);
  }, [done, visible, onClose]);

  const items = (snapshot?.pendings ?? []).filter((pending) => !savedIds.has(pending.contextId));
  const multi = (snapshot?.pendings.length ?? 0) > 1;
  const payloads = buildReviewPayloads(items, ratings, comments);

  const setRating = (contextId: string, key: string, value: number) =>
    setRatings((prev) => ({ ...prev, [contextId]: { ...prev[contextId], [key]: value } }));
  const setComment = (contextId: string, key: string, text: string) =>
    setComments((prev) => ({ ...prev, [contextId]: { ...prev[contextId], [key]: text } }));

  // One POST per ride (per rider on a driver's sheet). Stops at the first
  // failure other than a 409, keeping what saved, so a retry only sends the rest.
  const handleSubmit = async () => {
    if (payloads.length === 0 || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const saved = new Set(savedIds);
    for (const payload of payloads) {
      try {
        await createReview.mutateAsync(payload);
        saved.add(payload.contextId);
      } catch (error) {
        const apiError = normalizeApiError(error);
        if (apiError.kind === 'conflict') {
          saved.add(payload.contextId);
          continue;
        }
        const pending = items.find((item) => item.contextId === payload.contextId);
        const who = multi && pending ? ` for ${pending.targets[0]?.label ?? 'this rider'}` : '';
        setSavedIds(saved);
        setSubmitError(`Couldn't save your rating${who}: ${apiError.message}`);
        setSubmitting(false);
        return;
      }
    }
    setSavedIds(saved);
    setSubmitting(false);
    setDone(true);
  };

  if (!snapshot) return null;

  return (
    <AppSheet visible={visible} onClose={onClose} title={snapshot.title} subtitle={snapshot.subtitle}>
      {done ? (
        <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
          <Ionicons name="checkmark-circle" size={48} color={colors.success} />
          <AppText variant="subtitle" style={{ marginTop: spacing.sm }}>
            Thanks for rating!
          </AppText>
          <AppText muted style={{ marginTop: spacing.xs, textAlign: 'center' }}>
            Your feedback keeps KerayeGo rides safe and friendly.
          </AppText>
          <AppButton title="Done" variant="secondary" onPress={onClose} style={{ marginTop: spacing.lg }} />
        </View>
      ) : (
        <>
          <ScrollView keyboardShouldPersistTaps="handled">
            {snapshot.note ? (
              <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
                {snapshot.note}
              </AppText>
            ) : null}
            {items.length === 0 ? (
              <AppText muted style={{ marginBottom: spacing.md }}>
                Nothing left to rate here.
              </AppText>
            ) : null}
            {items.flatMap((pending) =>
              pending.targets.map((target) => {
                const key = targetKey(target);
                const stars = ratings[pending.contextId]?.[key] ?? 0;
                return (
                  <View key={`${pending.contextId}|${key}`} style={{ marginBottom: spacing.lg }}>
                    <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                      {target.label}
                    </AppText>
                    <RatingStars value={stars} onChange={(value) => setRating(pending.contextId, key, value)} size="lg" />
                    {stars > 0 ? (
                      <AppInput
                        style={{ marginTop: spacing.sm, marginBottom: 0 }}
                        multiline
                        numberOfLines={2}
                        maxLength={MAX_REVIEW_COMMENT_LENGTH}
                        placeholder="Add a comment (optional)"
                        value={comments[pending.contextId]?.[key] ?? ''}
                        onChangeText={(text) => setComment(pending.contextId, key, text)}
                      />
                    ) : null}
                  </View>
                );
              }),
            )}
          </ScrollView>

          {submitError ? (
            <AppText color={colors.danger} style={{ marginBottom: spacing.md }}>
              {submitError}
            </AppText>
          ) : null}

          <AppButton
            title={multi && payloads.length > 1 ? `Submit ${payloads.length} ratings` : 'Submit rating'}
            disabled={payloads.length === 0}
            loading={submitting}
            onPress={handleSubmit}
          />
          {dismissLabel ? (
            <AppButton title={dismissLabel} variant="ghost" onPress={onClose} style={{ marginTop: spacing.xs }} />
          ) : null}
        </>
      )}
    </AppSheet>
  );
}
