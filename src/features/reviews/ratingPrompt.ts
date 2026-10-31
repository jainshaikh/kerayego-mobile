import type { CreateReviewPayload, EligibleForReview } from '../../api/reviews.api';
import {
  buildReviewPayload,
  customerBookingRating,
  driverTripRating,
  riderTripRating,
  type PendingRating,
} from './rateTargets';

// Which of the server's "to rate" rows (GET /reviews/my/eligible) belong to
// the ride on screen — the end-of-ride rating sheet and its card only ever
// offer what that list still holds, so a ride rated on another device (or
// already rated here) never asks again.

/**
 * Riders of one carpool trip the driver can still rate, one PendingRating
 * (one POST) each — every rider is a separate trip request. The backend
 * already leaves out no-shows; `excludeInquiryIds` drops riders this screen
 * knows were marked one since the list was fetched. Each target is labelled
 * with the rider's name, since one sheet lists them all.
 */
export function driverTripPendingRatings(
  eligible: EligibleForReview | undefined,
  tripId: string,
  excludeInquiryIds: readonly string[] = [],
): PendingRating[] {
  if (!eligible) return [];
  return eligible.tripsAsDriver
    .filter((entry) => entry.trip.id === tripId && !excludeInquiryIds.includes(entry.id))
    .flatMap((entry) => {
      const rating = driverTripRating(entry);
      if (!rating) return [];
      const name = entry.user?.name?.trim() || 'Rider';
      return [{ ...rating, targets: rating.targets.map((target) => ({ ...target, label: name })) }];
    });
}

/** The rider's own seat on a carpool trip, while it's still unrated (car + driver, per riderTripRating). */
export function riderTripPendingRating(eligible: EligibleForReview | undefined, tripInquiryId: string): PendingRating | null {
  const entry = eligible?.tripsAsRider.find((row) => row.id === tripInquiryId);
  return entry ? riderTripRating(entry) : null;
}

/** A rental the customer booked, while it's still unrated (car + driver, per customerBookingRating). */
export function customerBookingPendingRating(
  eligible: EligibleForReview | undefined,
  bookingId: string,
): PendingRating | null {
  const entry = eligible?.bookingsAsCustomer.find((row) => row.id === bookingId);
  return entry ? customerBookingRating(entry) : null;
}

/**
 * Whether the active-ride lock (useActiveRideLock, app/_layout.tsx) is about
 * to move the user off this screen: they have a ride locked elsewhere. A
 * sheet opened now would be torn away by the redirect.
 */
export function isLockRedirectPending(lockedPathname: string | null, currentPathname: string): boolean {
  return lockedPathname !== null && lockedPathname !== currentPathname;
}

export interface RatingPromptFacts {
  // The ride is over on the server (not just optimistically on this device).
  rideOver: boolean;
  // The eligible list has loaded and isn't mid-refetch — it's the source of truth.
  eligibleSettled: boolean;
  // How many ratings it still holds for this ride.
  pendingCount: number;
  // Whether the sheet opened on its own for this ride before; null while that's still being read.
  alreadyShown: boolean | null;
  // The rating sheet itself is open already.
  sheetOpen: boolean;
  // Another sheet on the screen is open.
  otherSheetOpen: boolean;
  // The active-ride lock is still settling or about to redirect.
  lockRedirecting: boolean;
}

/** Whether to open the rating sheet on its own now — once per ride per device, only while something is unrated. */
export function shouldAutoOpenRatingPrompt(facts: RatingPromptFacts): boolean {
  return (
    facts.rideOver &&
    facts.eligibleSettled &&
    facts.pendingCount > 0 &&
    facts.alreadyShown === false &&
    !facts.sheetOpen &&
    !facts.otherSheetOpen &&
    !facts.lockRedirecting
  );
}

// Ratings/comments in a sheet that can hold several PendingRatings: by
// contextId, then by targetKey.
export type RatingsByContext = Record<string, Record<string, number | undefined> | undefined>;
export type CommentsByContext = Record<string, Record<string, string | undefined> | undefined>;

/**
 * One POST /reviews body per PendingRating that's fully rated (each stays
 * all-or-nothing, see buildReviewPayload). Ones not rated yet are skipped —
 * a driver may rate only some riders.
 */
export function buildReviewPayloads(
  pendings: readonly PendingRating[],
  ratings: RatingsByContext,
  comments: CommentsByContext,
): CreateReviewPayload[] {
  return pendings.flatMap((pending) => {
    const payload = buildReviewPayload(pending, ratings[pending.contextId] ?? {}, comments[pending.contextId] ?? {});
    return payload ? [payload] : [];
  });
}
