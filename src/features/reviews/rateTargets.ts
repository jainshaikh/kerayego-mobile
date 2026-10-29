import type {
  CreateReviewPayload,
  EligibleBooking,
  EligibleTrip,
  ReviewContext,
  ReviewEntryInput,
  ReviewSubjectType,
} from '../../api/reviews.api';

// What one rating sheet asks about. Mirrors exactly the entries
// ReviewsService.createForBooking/createForTrip lets the caller submit — the
// backend rejects the WHOLE batch (403) if any one entry isn't allowed, so
// nothing here may offer a subject it wouldn't accept (A18: never the
// business).

export interface RateTarget {
  subjectType: ReviewSubjectType;
  subjectId: string;
  label: string;
}

export interface PendingRating {
  context: ReviewContext;
  contextId: string;
  title: string;
  targets: RateTarget[];
}

export const CAR_LABEL = 'How was the car?';
export const DRIVER_LABEL = 'How was your driver?';

// CreateReviewDto: 1–2 entries, rating an integer 1–5, comment ≤ 1000 chars.
export const MAX_REVIEW_ENTRIES = 2;
export const MAX_REVIEW_COMMENT_LENGTH = 1000;

/** Stable key for a target's rating/comment state. */
export function targetKey(target: Pick<RateTarget, 'subjectType' | 'subjectId'>): string {
  return `${target.subjectType}:${target.subjectId}`;
}

/** The rental driver's display name — their verified profile name first. */
export function bookingDriverName(booking: EligibleBooking): string | null {
  const driver = booking.assignedDriver;
  if (!driver) return null;
  return driver.driverProfile?.fullName || driver.name || null;
}

/**
 * A completed rental, as the customer: the car (VEHICLE) and — only when the
 * booking had an assigned driver — that driver (USER). Empty when the backend
 * sent no vehicle, so the row can't be rated.
 */
export function customerBookingRating(booking: EligibleBooking): PendingRating | null {
  const targets: RateTarget[] = [];
  if (booking.vehicle?.id) {
    targets.push({ subjectType: 'VEHICLE', subjectId: booking.vehicle.id, label: CAR_LABEL });
  }
  const driverId = booking.assignedDriverId ?? booking.assignedDriver?.id ?? null;
  if (driverId) {
    targets.push({ subjectType: 'USER', subjectId: driverId, label: DRIVER_LABEL });
  }
  if (targets.length === 0) return null;
  return {
    context: 'BOOKING_REQUEST',
    contextId: booking.id,
    title: `Rate: ${booking.vehicle?.title ?? 'your rental'}`,
    targets,
  };
}

/**
 * A departed carpool trip, as the rider: the car — the business's fleet car
 * (VEHICLE) on a return trip, else the driver's own car (USER_VEHICLE) — and
 * the driver (USER).
 */
export function riderTripRating(inquiry: EligibleTrip): PendingRating | null {
  const { trip } = inquiry;
  const targets: RateTarget[] = [];
  if (trip.isReturnTrip && trip.fleetVehicleId) {
    targets.push({ subjectType: 'VEHICLE', subjectId: trip.fleetVehicleId, label: CAR_LABEL });
  } else if (trip.userVehicleId) {
    targets.push({ subjectType: 'USER_VEHICLE', subjectId: trip.userVehicleId, label: CAR_LABEL });
  }
  if (trip.postedByUserId) {
    targets.push({ subjectType: 'USER', subjectId: trip.postedByUserId, label: DRIVER_LABEL });
  }
  if (targets.length === 0) return null;
  return {
    context: 'TRIP_INQUIRY',
    contextId: inquiry.id,
    title: `Rate your trip: ${trip.originCity} → ${trip.destinationCity}`,
    targets,
  };
}

/** A departed carpool trip, as its driver: the rider only (private). */
export function driverTripRating(inquiry: EligibleTrip): PendingRating | null {
  if (!inquiry.user?.id) return null;
  return {
    context: 'TRIP_INQUIRY',
    contextId: inquiry.id,
    title: `Rate rider: ${inquiry.user.name ?? ''}`,
    targets: [{ subjectType: 'USER', subjectId: inquiry.user.id, label: 'The rider' }],
  };
}

/** A completed rental, as the business: the customer only (private). */
export function providerBookingRating(booking: EligibleBooking): PendingRating | null {
  if (!booking.user?.id) return null;
  return {
    context: 'BOOKING_REQUEST',
    contextId: booking.id,
    title: `Rate customer: ${booking.user.name ?? ''}`,
    targets: [{ subjectType: 'USER', subjectId: booking.user.id, label: 'The customer' }],
  };
}

function isValidRating(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * The POST /reviews body for a rating sheet, or null until every target has a
 * valid 1–5 rating. All-or-nothing on purpose: the backend hides a booking or
 * trip from "to rate" as soon as ANY review exists for it, so sending only
 * some entries would lose the rest for good — and any entry it doesn't accept
 * fails the whole batch.
 */
export function buildReviewPayload(
  pending: PendingRating,
  ratings: Record<string, number | undefined>,
  comments: Record<string, string | undefined>,
): CreateReviewPayload | null {
  const targets = pending.targets.slice(0, MAX_REVIEW_ENTRIES);
  if (targets.length === 0) return null;
  const entries: ReviewEntryInput[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    const rating = ratings[key];
    if (!target.subjectId || !isValidRating(rating)) return null;
    const comment = comments[key]?.trim().slice(0, MAX_REVIEW_COMMENT_LENGTH);
    entries.push({
      subjectType: target.subjectType,
      subjectId: target.subjectId,
      rating,
      ...(comment ? { comment } : {}),
    });
  }
  return { context: pending.context, contextId: pending.contextId, entries };
}
