import { useLocalSearchParams } from 'expo-router';

import { useTripInquiry } from '../../../features/trip-inquiries/queries';
import { useOfflineTripQueue } from '../../../features/trips/offlineSync';
import { useRideSocket } from '../../../features/liveRide/socket';
import { useTripRoomPresence } from '../../../features/liveRide/useTripRoomPresence';
import { useBlockBackButtonWhileActive } from '../../../features/liveRide/useBlockBackButtonWhileActive';
import { ErrorState, LoadingState } from '../../../components/ui';
import { TripInquiryStatus, TripStatus, tripInquiryRiderActions } from '../../../types/enums';
import { useRiderLiveRoute } from '../../../features/trip-inquiries/riderLiveTrip/useRiderLiveRoute';
import { useRiderTripActions } from '../../../features/trip-inquiries/riderLiveTrip/useRiderTripActions';
import { computeRideActionAvailability } from '../../../features/trip-inquiries/riderLiveTrip/rideActionAvailability';
import { RiderPreLiveView } from '../../../features/trip-inquiries/riderLiveTrip/RiderPreLiveView';
import { RiderLiveView } from '../../../features/trip-inquiries/riderLiveTrip/RiderLiveView';

export default function MyTripRequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: inquiry, isLoading, isError, refetch } = useTripInquiry(id);
  const offlineQueue = useOfflineTripQueue(inquiry?.trip.id);
  const { isConnected } = useRideSocket();

  // Live for this rider only once their seat is accepted AND the driver has
  // actually started the trip.
  const tripLive = inquiry?.status === TripInquiryStatus.ACCEPTED && inquiry?.trip.status === TripStatus.IN_PROGRESS;
  const pickupStop = inquiry?.pickupStop ?? null;
  const dropoffStop = inquiry?.dropoffStop ?? null;

  const route = useRiderLiveRoute({
    tripId: inquiry?.trip.id,
    tripLive,
    pickupStop,
    dropoffStop,
    pickupConfirmedAt: inquiry?.pickupConfirmedAt ?? null,
    droppedOffAt: inquiry?.droppedOffAt ?? null,
  });
  const riderActions = useRiderTripActions({
    inquiryId: id as string,
    tripId: inquiry?.trip.id ?? '',
    offlineQueue,
    position: route.position,
    refetch,
  });

  useTripRoomPresence(inquiry?.trip.id, tripLive);
  useBlockBackButtonWhileActive(tripLive);

  if (isLoading) return <LoadingState label="Loading request..." />;
  if (isError || !inquiry) return <ErrorState message="Couldn't load this request." onRetry={refetch} />;

  const availableActions = tripInquiryRiderActions(inquiry.status);
  const rideActionAvailability = computeRideActionAvailability({
    pickupConfirmedAt: inquiry.pickupConfirmedAt,
    droppedOffAt: inquiry.droppedOffAt,
    tripStatus: inquiry.trip.status,
    hasPickupStop: pickupStop !== null,
    hasDropoffStop: dropoffStop !== null,
    pickupDistanceM: route.pickupDistanceM,
    dropoffDistanceM: route.dropoffDistanceM,
    locationDenied: route.locationDenied,
    hasPosition: !!route.position,
  });

  if (!tripLive) {
    return (
      <RiderPreLiveView
        inquiry={inquiry}
        availableActions={availableActions}
        riderActions={riderActions}
        rideActionAvailability={rideActionAvailability}
      />
    );
  }

  return (
    <RiderLiveView
      inquiry={inquiry}
      pickupStop={pickupStop}
      dropoffStop={dropoffStop}
      dropoffSequence={route.dropoffSequence}
      availableActions={availableActions}
      isConnected={isConnected}
      route={route}
      riderActions={riderActions}
      rideActionAvailability={rideActionAvailability}
    />
  );
}
