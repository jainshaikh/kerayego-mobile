import {
  TripInquiryStatus,
  TripStatus,
  tripInquiryRiderActions,
  tripInquiryStatusMeta,
  type StatusTone,
} from '../../../types/enums';

/**
 * Where this rider's request stands, from the server's own fields — the one
 * switch the trip-request screen renders from.
 * - request: not (or no longer) a confirmed seat — PENDING/REJECTED/CANCELLED/EXPIRED.
 * - upcoming: confirmed, the trip hasn't started yet.
 * - live: confirmed and riding (or about to be picked up) right now — the
 *   only stage that locks navigation and runs GPS/socket/ETA work.
 * - droppedOff / noShow: this rider is done (the trip may still be running
 *   for the others).
 * - tripCompleted / tripCancelled / tripSuspended / tripUnavailable: a
 *   confirmed seat on a trip that ended, was called off, taken down by an
 *   admin, or is in a legacy status — with nothing recorded for this rider.
 */
export type RiderSeatStage =
  | 'request'
  | 'upcoming'
  | 'live'
  | 'droppedOff'
  | 'noShow'
  | 'tripCompleted'
  | 'tripCancelled'
  | 'tripSuspended'
  | 'tripUnavailable';

export interface RiderSeatFacts {
  inquiryStatus: TripInquiryStatus;
  tripStatus: TripStatus;
  droppedOffAt: string | null;
  // Absent from an older backend, which has no no-show state.
  noShowAt?: string | null;
}

export function riderSeatStage({ inquiryStatus, tripStatus, droppedOffAt, noShowAt }: RiderSeatFacts): RiderSeatStage {
  if (inquiryStatus !== TripInquiryStatus.ACCEPTED) return 'request';
  // The backend never lets both be set (a no-show can't be dropped off, and
  // a dropped-off rider can't be marked no-show).
  if (droppedOffAt) return 'droppedOff';
  if (noShowAt) return 'noShow';
  switch (tripStatus) {
    case TripStatus.ACTIVE:
      return 'upcoming';
    case TripStatus.IN_PROGRESS:
      return 'live';
    case TripStatus.COMPLETED:
      return 'tripCompleted';
    case TripStatus.CANCELLED:
      return 'tripCancelled';
    case TripStatus.SUSPENDED:
      return 'tripSuspended';
    default:
      return 'tripUnavailable';
  }
}

/**
 * The rider's ride lock — mirrors the driver cockpit's: while true the screen
 * hides its header, disables swipe-back and swallows the hardware back
 * button. It releases as soon as the rider is dropped off or marked as a
 * no-show, even while the trip keeps running for everyone else — the same
 * moment GET /my/active-ride stops returning them.
 */
export function isRideLocked(facts: RiderSeatFacts): boolean {
  return riderSeatStage(facts) === 'live';
}

/**
 * Which status changes the rider can still make, given where the seat
 * stands: none once they've been dropped off or marked a no-show (the ride is
 * over for them; a no-show contacts the driver instead), otherwise the
 * status/trip-status rule in tripInquiryRiderActions.
 */
export function riderSeatActions(
  stage: RiderSeatStage,
  inquiryStatus: TripInquiryStatus,
  tripStatus: TripStatus,
): TripInquiryStatus[] {
  if (stage === 'droppedOff' || stage === 'noShow') return [];
  return tripInquiryRiderActions(inquiryStatus, tripStatus);
}

// The live ride's own phase (stage 'live' only — drop-off and no-show end it):
// headToPickup → waitingAtPickup (the rider's own "I reached the stop", which
// the server doesn't keep) → onBoard (the driver's Pickup).
export type RiderRidePhase = 'headToPickup' | 'waitingAtPickup' | 'onBoard';

export interface RiderRidePhaseFacts {
  pickupConfirmedAt: string | null;
  // The rider's own ARRIVED tap (queued or applied this session).
  riderConfirmedAtPickup: boolean;
}

/** The server's pickup first; the rider's own local ARRIVED only splits the pre-pickup phase in two. */
export function deriveRiderRidePhase({ pickupConfirmedAt, riderConfirmedAtPickup }: RiderRidePhaseFacts): RiderRidePhase {
  if (pickupConfirmedAt) return 'onBoard';
  return riderConfirmedAtPickup ? 'waitingAtPickup' : 'headToPickup';
}

export interface BadgeCopy {
  label: string;
  tone: StatusTone;
}

export interface LiveRideCopy {
  // The live view's own header badge.
  badge: BadgeCopy;
  // The Driver tab's badge.
  driverBadge: BadgeCopy;
  // The pinned bar's main line.
  progressTitle: string;
}

export interface LiveRideCopyInput {
  phase: RiderRidePhase;
  // The driver's Reached at this rider's pickup stop is on the server.
  driverAtPickup: boolean;
  // Live driver ETA (minutes) to the phase's target stop, null when unknown.
  etaMinutes: number | null;
  // The rider's own drop-off is saved but not synced yet.
  dropoffQueued: boolean;
}

function etaPhrase(minutes: number): string | null {
  const rounded = Math.round(minutes);
  return rounded < 1 ? null : `~${rounded} min`;
}

export function liveRideCopy({ phase, driverAtPickup, etaMinutes, dropoffQueued }: LiveRideCopyInput): LiveRideCopy {
  const eta = etaMinutes !== null ? etaPhrase(etaMinutes) : null;

  if (phase === 'onBoard') {
    return {
      badge: { label: 'On Board', tone: 'info' },
      driverBadge: { label: 'Driving', tone: 'accent' },
      progressTitle: dropoffQueued
        ? 'Drop-off saved — waiting to sync'
        : etaMinutes === null
          ? 'On the way to your drop-off'
          : eta
            ? `Drop-off in ${eta}`
            : 'Arriving at your drop-off',
    };
  }

  // Once the driver is at the pickup stop an ETA to it means nothing.
  if (driverAtPickup) {
    return {
      badge: { label: 'Driver Arrived', tone: 'success' },
      driverBadge: { label: 'At Your Pickup', tone: 'success' },
      progressTitle: 'Your driver is at the pickup point',
    };
  }

  const waiting = phase === 'waitingAtPickup';
  return {
    badge: waiting ? { label: 'Driver On The Way', tone: 'success' } : { label: 'Head To Pickup', tone: 'warning' },
    driverBadge: { label: 'On The Way', tone: 'accent' },
    progressTitle:
      etaMinutes !== null
        ? eta
          ? `Pickup in ${eta}`
          : 'Driver arriving now'
        : waiting
          ? 'Waiting for driver'
          : 'Head to your pickup point',
  };
}

/** The header badge for every stage the scrolling overview shows (all but live). */
export function seatStageBadge(stage: RiderSeatStage, inquiryStatus: TripInquiryStatus): BadgeCopy {
  switch (stage) {
    case 'upcoming':
      return { label: 'Seat confirmed', tone: 'success' };
    case 'live':
      return { label: 'On the trip', tone: 'info' };
    case 'droppedOff':
    case 'tripCompleted':
      return { label: 'Completed', tone: 'complete' };
    case 'noShow':
      return { label: 'No-show', tone: 'danger' };
    case 'tripCancelled':
      return { label: 'Trip cancelled', tone: 'neutral' };
    case 'tripSuspended':
      return { label: 'Trip suspended', tone: 'danger' };
    case 'tripUnavailable':
      return { label: 'Unavailable', tone: 'neutral' };
    default:
      return tripInquiryStatusMeta[inquiryStatus];
  }
}

/**
 * Heading for the request's rejectionReason — which, despite its name, also
 * carries the reason a request was CANCELLED by the driver's trip
 * cancellation or EXPIRED automatically. null where none is ever shown.
 */
export function rejectionReasonHeading(status: TripInquiryStatus): string | null {
  switch (status) {
    case TripInquiryStatus.REJECTED:
      return 'Note from the driver';
    case TripInquiryStatus.CANCELLED:
      return 'Why it was cancelled';
    case TripInquiryStatus.EXPIRED:
      return 'Why it expired';
    default:
      return null;
  }
}

/**
 * Why a still-PENDING request won't be answered, when its trip has stopped
 * taking riders — the driver can only accept on an ACTIVE trip (a 409
 * otherwise), and an admin suspension doesn't close open requests the way a
 * driver's cancellation does. null while the trip is ACTIVE (or the request
 * isn't pending).
 */
export function pendingRequestTripNote(inquiryStatus: TripInquiryStatus, tripStatus: TripStatus): string | null {
  if (inquiryStatus !== TripInquiryStatus.PENDING) return null;
  switch (tripStatus) {
    case TripStatus.ACTIVE:
      return null;
    case TripStatus.SUSPENDED:
      return "KerayeGo has suspended this trip, so this request can't be accepted for now.";
    case TripStatus.CANCELLED:
      return "This trip was cancelled, so this request can't be accepted.";
    case TripStatus.IN_PROGRESS:
      return 'This trip has already started, so this request can no longer be accepted.';
    case TripStatus.COMPLETED:
      return 'This trip has already ended, so this request can no longer be accepted.';
    default:
      return "This trip isn't taking seat requests right now.";
  }
}

export interface ConfirmSheetCopy {
  title: string;
  body: string;
  confirmLabel: string;
  dismissLabel: string;
}

export interface ConfirmSheetContext {
  inquiryStatus: TripInquiryStatus;
  tripStatus: TripStatus;
  driverName: string;
  dropoffLabel: string;
}

/** What the rider is asked before cancelling (a request or a confirmed seat) or reporting their own drop-off. */
export function confirmSheetCopy(
  kind: 'cancel' | 'dropoff',
  { inquiryStatus, tripStatus, driverName, dropoffLabel }: ConfirmSheetContext,
): ConfirmSheetCopy {
  if (kind === 'dropoff') {
    return {
      title: 'Complete your ride?',
      body: `Only confirm once you've arrived at ${dropoffLabel}. ${driverName} will see that you've been dropped off, and this can't be undone.`,
      confirmLabel: "Yes, I've arrived",
      dismissLabel: 'Not yet',
    };
  }
  if (inquiryStatus !== TripInquiryStatus.ACCEPTED) {
    return {
      title: 'Cancel this request?',
      body: `${driverName} won't see your request any more.`,
      confirmLabel: 'Cancel request',
      dismissLabel: 'Keep request',
    };
  }
  return {
    title: 'Cancel your seat?',
    body:
      tripStatus === TripStatus.IN_PROGRESS
        ? `${driverName} has already started this trip. Cancelling gives up your seat and lets them know — this can't be undone.`
        : `Your seat goes back on sale and ${driverName} is notified. This can't be undone.`,
    confirmLabel: 'Cancel seat',
    dismissLabel: 'Keep my seat',
  };
}

/** "just now", "1 min ago", "12 min ago", "2 h ago", "1 h 5 min ago" — whole minutes, rounded down. */
export function formatAgo(elapsedMs: number): string {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} h ${rest} min ago` : `${hours} h ago`;
}
