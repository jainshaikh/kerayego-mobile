import { useEffect, useState } from 'react';
import { usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import type { EligibleForReview } from '../../api/reviews.api';
import { hasShownRatingPrompt, markRatingPromptShown, ratingPromptKey, type RatingPromptContext } from '../../storage/rating-prompt';
import { activeRidePathname } from '../notifications/pushRouting';
import { useMyActiveRide } from '../trips/queries';
import { useMyEligibleReviews } from './queries';
import { isLockRedirectPending, shouldAutoOpenRatingPrompt } from './ratingPrompt';
import type { PendingRating } from './rateTargets';

// A beat after the ride-over view appears before the sheet slides up — so the
// summary is seen first, and the sheet never presents while the sheet that
// ended the ride (End trip / Complete ride confirm) is still sliding away.
const AUTO_OPEN_DELAY_MS = 700;

interface UseRatingPromptParams {
  context: RatingPromptContext;
  // The ride's id for `context` (see storage/rating-prompt.ts); undefined until loaded.
  id: string | undefined;
  // The ride is over on the server.
  rideOver: boolean;
  // This ride's rows in the eligible list (see features/reviews/ratingPrompt.ts).
  pick: (eligible: EligibleForReview | undefined) => PendingRating[];
  // Another sheet on the screen is open — the rating sheet waits for it.
  otherSheetOpen: boolean;
}

export interface RatingPrompt {
  // What's still unrated for this ride — drives the screen's card.
  pendings: PendingRating[];
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

/**
 * The end-of-ride rating prompt for one ride: opens the rating sheet on its
 * own once the ride is over and the server still lists it as unrated — once
 * per ride per device (storage/rating-prompt.ts), never on top of another
 * sheet, and not while the active-ride lock is about to redirect away. The
 * eligible list is refreshed the moment the ride ends here.
 */
export function useRatingPrompt({ context, id, rideOver, pick, otherSheetOpen }: UseRatingPromptParams): RatingPrompt {
  const queryClient = useQueryClient();
  const eligible = useMyEligibleReviews();
  const pathname = usePathname();
  // Same query (and 20 s poll) the root layout's lock reads.
  const activeRide = useMyActiveRide();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Whether this ride's sheet opened on its own before, for the key it was read for.
  const [shown, setShown] = useState<{ key: string; value: boolean } | null>(null);

  const key = id ? ratingPromptKey(context, id) : null;
  const alreadyShown = key !== null && shown?.key === key ? shown.value : null;
  const pendings = pick(eligible.data);

  useEffect(() => {
    if (!id) return;
    const readKey = ratingPromptKey(context, id);
    let cancelled = false;
    void hasShownRatingPrompt(context, id).then((value) => {
      if (!cancelled) setShown({ key: readKey, value });
    });
    return () => {
      cancelled = true;
    };
  }, [context, id]);

  // The ride just ended (or this screen just opened on an ended one): the
  // cached list may predate it — the server only lists a ride once it's over.
  useEffect(() => {
    if (rideOver) void queryClient.invalidateQueries({ queryKey: ['reviews', 'my', 'eligible'] });
  }, [rideOver, queryClient]);

  const lockRedirecting =
    activeRide.isPending || isLockRedirectPending(activeRidePathname(activeRide.data), pathname);

  const autoOpen = shouldAutoOpenRatingPrompt({
    rideOver,
    eligibleSettled: eligible.isSuccess && !eligible.isFetching,
    pendingCount: pendings.length,
    alreadyShown,
    sheetOpen,
    otherSheetOpen,
    lockRedirecting,
  });

  useEffect(() => {
    if (!autoOpen || !id) return;
    const timer = setTimeout(() => {
      setSheetOpen(true);
      setShown({ key: ratingPromptKey(context, id), value: true });
      void markRatingPromptShown(context, id);
    }, AUTO_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoOpen, context, id]);

  return {
    pendings,
    sheetOpen,
    openSheet: () => setSheetOpen(true),
    closeSheet: () => setSheetOpen(false),
  };
}
