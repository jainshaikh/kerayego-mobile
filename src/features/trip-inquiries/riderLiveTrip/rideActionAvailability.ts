import { TripStatus } from '../../../types/enums';

// Rider must be within this many meters of a stop for the geofence-gated
// arrive/complete buttons to enable — mirrors the backend's own check.
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
  pickupConfirmedAt: string | null;
  droppedOffAt: string | null;
  tripStatus: TripStatus;
  hasPickupStop: boolean;
  hasDropoffStop: boolean;
  pickupDistanceM: number | null;
  dropoffDistanceM: number | null;
  locationDenied: boolean;
  hasPosition: boolean;
}

// Whether the rider can currently self-report ARRIVED (at pickup) or
// DROPOFF (at dropoff), and why not if not — shared by the pre-live view
// (RiderPreLiveView) and the tripLive Stops tab, both of which gate their
// own action buttons on this exact same availability.
export function computeRideActionAvailability({
  pickupConfirmedAt,
  droppedOffAt,
  tripStatus,
  hasPickupStop,
  hasDropoffStop,
  pickupDistanceM,
  dropoffDistanceM,
  locationDenied,
  hasPosition,
}: ComputeRideActionAvailabilityParams): RideActionAvailability {
  const showArriveButton = !pickupConfirmedAt && tripStatus === TripStatus.IN_PROGRESS && hasPickupStop;
  const canArrive = pickupDistanceM !== null && pickupDistanceM <= GEOFENCE_RADIUS_M;
  const arriveDisabledReason = locationDenied
    ? 'Enable location access to confirm your arrival.'
    : !hasPosition
      ? 'Waiting for your location…'
      : 'Move within 100m of your pickup point to confirm arrival.';

  const showCompleteButton = !droppedOffAt && (tripStatus === TripStatus.IN_PROGRESS || tripStatus === TripStatus.COMPLETED);
  const canComplete = !hasDropoffStop || (dropoffDistanceM !== null && dropoffDistanceM <= GEOFENCE_RADIUS_M);
  const completeDisabledReason = locationDenied
    ? 'Enable location access to complete the ride.'
    : !hasPosition
      ? 'Waiting for your location…'
      : 'Move within 100m of your drop-off point to complete the ride.';

  return { showArriveButton, canArrive, arriveDisabledReason, showCompleteButton, canComplete, completeDisabledReason };
}
