import { TripInquiryStatus, TripStatus } from '../../../types/enums';

// Rider must be within this many meters of a stop for the geofence-gated
// arrive/complete buttons to enable. The app's own rule: the backend only
// audits the distance it's sent (it logs a warning past 300 m) and never
// blocks the event.
const GEOFENCE_RADIUS_M = 100;

export interface RideActionAvailability {
  showArriveButton: boolean;
  canArrive: boolean;
  arriveDisabledReason: string;
  showCompleteButton: boolean;
  canComplete: boolean;
  completeDisabledReason: string;
}

interface ComputeRideActionAvailabilityParams {
  inquiryStatus: TripInquiryStatus;
  tripStatus: TripStatus;
  pickupConfirmedAt: string | null;
  droppedOffAt: string | null;
  // Absent from an older backend.
  noShowAt: string | null | undefined;
  // The rider's pickup/drop-off stop exists AND has map coordinates to
  // measure against — a stop typed as free text can't be geofenced, so it's
  // treated like having no stop at all (no arrive button; complete anywhere).
  pickupStopLocated: boolean;
  dropoffStopLocated: boolean;
  pickupDistanceM: number | null;
  dropoffDistanceM: number | null;
  locationDenied: boolean;
  hasPosition: boolean;
}

// Whether the rider can currently self-report ARRIVED (at pickup) or
// DROPOFF (at dropoff), and why not if not — gated the way the backend
// accepts these events: only on a confirmed seat, only while the trip is
// IN_PROGRESS, and never for a rider marked as a no-show (a 409 there).
export function computeRideActionAvailability({
  inquiryStatus,
  tripStatus,
  pickupConfirmedAt,
  droppedOffAt,
  noShowAt,
  pickupStopLocated,
  dropoffStopLocated,
  pickupDistanceM,
  dropoffDistanceM,
  locationDenied,
  hasPosition,
}: ComputeRideActionAvailabilityParams): RideActionAvailability {
  const riding = inquiryStatus === TripInquiryStatus.ACCEPTED && tripStatus === TripStatus.IN_PROGRESS && !noShowAt;

  const showArriveButton = riding && !pickupConfirmedAt && !droppedOffAt && pickupStopLocated;
  const canArrive = pickupDistanceM !== null && pickupDistanceM <= GEOFENCE_RADIUS_M;
  const arriveDisabledReason = locationDenied
    ? 'Enable location access to confirm your arrival.'
    : !hasPosition
      ? 'Waiting for your location…'
      : 'Move within 100m of your pickup point to confirm arrival.';

  const showCompleteButton = riding && !droppedOffAt;
  const canComplete = !dropoffStopLocated || (dropoffDistanceM !== null && dropoffDistanceM <= GEOFENCE_RADIUS_M);
  const completeDisabledReason = locationDenied
    ? 'Enable location access to complete the ride.'
    : !hasPosition
      ? 'Waiting for your location…'
      : 'Move within 100m of your drop-off point to complete the ride.';

  return { showArriveButton, canArrive, arriveDisabledReason, showCompleteButton, canComplete, completeDisabledReason };
}
