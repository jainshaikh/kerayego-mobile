import { Stack, useLocalSearchParams } from 'expo-router';

import { useMyTrip, useTripManifest } from '../../../features/trips/queries';
import { useOfflineTripQueue } from '../../../features/trips/offlineSync';
import { useRideSocket } from '../../../features/liveRide/socket';
import { useTripRoomPresence } from '../../../features/liveRide/useTripRoomPresence';
import { useBlockBackButtonWhileActive } from '../../../features/liveRide/useBlockBackButtonWhileActive';
import { useTripInquiryInbox, useUpdateTripInquiryStatus } from '../../../features/trip-inquiries/queries';
import { useAuth } from '../../../auth/auth-context';
import { AppScreen, ErrorState, LoadingState } from '../../../components/ui';
import { TripStatus } from '../../../types/enums';
import { useDriverLocationWatch } from '../../../features/trips/driverCockpit/useDriverLocationWatch';
import { useDriverStopProgress } from '../../../features/trips/driverCockpit/useDriverStopProgress';
import { useDriverTripActions } from '../../../features/trips/driverCockpit/useDriverTripActions';
import { useDriverChatInbox } from '../../../features/trips/driverCockpit/useDriverChatInbox';
import { DriverLiveCockpit } from '../../../features/trips/driverCockpit/DriverLiveCockpit';
import { DriverPostedTripView } from '../../../features/trips/driverCockpit/DriverPostedTripView';

export default function MyTripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data: trip, isLoading, isError, refetch } = useMyTrip(id);
  const { data: inquiriesRes, isLoading: inquiriesLoading } = useTripInquiryInbox({ tripId: id as string });
  const updateInquiryStatus = useUpdateTripInquiryStatus();
  // Fetched (and cached by react-query) regardless of status — the backend
  // doesn't gate this on trip status either — so a manifest fetched earlier
  // while online is already sitting in cache if "Start trip" is later tapped
  // offline. Only the cockpit's own visibility is gated on effective status.
  const { data: manifest, isLoading: manifestLoading } = useTripManifest(id);
  const offlineQueue = useOfflineTripQueue(id);
  const { isConnected } = useRideSocket();

  const driverActions = useDriverTripActions(id as string, offlineQueue);

  // Computed here (not after the loading/error guards below) so every hook
  // that depends on it always runs in the same order.
  const effectiveInProgress =
    !!trip &&
    (trip.status === TripStatus.IN_PROGRESS || (trip.status === TripStatus.ACTIVE && driverActions.optimisticStarted));
  const effectiveCompleted =
    !!trip && (trip.status === TripStatus.COMPLETED || (effectiveInProgress && driverActions.optimisticEnded));

  useTripRoomPresence(id, effectiveInProgress);
  useBlockBackButtonWhileActive(effectiveInProgress);
  const location = useDriverLocationWatch(id as string, effectiveInProgress);
  const stopProgress = useDriverStopProgress({
    manifest,
    optimisticEvents: driverActions.optimisticEvents,
    currentPosition: location.currentPosition,
    active: effectiveInProgress,
  });
  const chat = useDriverChatInbox(user?.id);

  if (isLoading) return <LoadingState label="Loading trip..." />;
  if (isError || !trip) return <ErrorState message="Couldn't load this trip." onRetry={refetch} />;

  const showManifest = effectiveInProgress || effectiveCompleted;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      {/* Ride lock: the hardware/gesture back effect above already swallows
          the physical back button, but the native stack header's own back
          chevron and iOS/Android swipe-back gesture are a SEPARATE exit path
          it doesn't touch — suppress both here, only while the ride is
          actually in progress, so "End ride" stays the only way out.
          Restored automatically once the ride is no longer in progress. */}
      <Stack.Screen
        options={{ headerShown: !effectiveInProgress, gestureEnabled: !effectiveInProgress, title: 'Trip Details' }}
      />
      {showManifest ? (
        <DriverLiveCockpit
          trip={trip}
          manifest={manifest}
          manifestLoading={manifestLoading}
          effectiveInProgress={effectiveInProgress}
          effectiveCompleted={effectiveCompleted}
          isConnected={isConnected}
          stopProgress={stopProgress}
          location={location}
          actions={driverActions}
          chat={chat}
          offlineQueue={offlineQueue}
        />
      ) : (
        <DriverPostedTripView
          trip={trip}
          effectiveInProgress={effectiveInProgress}
          effectiveCompleted={effectiveCompleted}
          inquiries={inquiriesRes?.data ?? []}
          inquiriesLoading={inquiriesLoading}
          updateInquiryStatus={updateInquiryStatus}
          driverActions={driverActions}
          offlineQueue={offlineQueue}
        />
      )}
    </AppScreen>
  );
}
