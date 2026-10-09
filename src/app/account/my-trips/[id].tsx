import { Stack, useLocalSearchParams } from 'expo-router';

import { useMyTrip, useTripManifest } from '../../../features/trips/queries';
import { useOfflineTripQueue } from '../../../features/trips/offlineSync';
import { useRideSocket } from '../../../features/liveRide/socket';
import { useTripRoomPresence } from '../../../features/liveRide/useTripRoomPresence';
import { useBlockBackButtonWhileActive } from '../../../features/liveRide/useBlockBackButtonWhileActive';
import { useTripInquiryInbox, useUpdateTripInquiryStatus } from '../../../features/trip-inquiries/queries';
import { useAuth } from '../../../auth/auth-context';
import { AppRefreshControl, AppScreen, ErrorState, LoadingState } from '../../../components/ui';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { TripStatus } from '../../../types/enums';
import { useDriverLocationWatch } from '../../../features/trips/driverCockpit/useDriverLocationWatch';
import { useDriverStopProgress } from '../../../features/trips/driverCockpit/useDriverStopProgress';
import { useDriverTripActions } from '../../../features/trips/driverCockpit/useDriverTripActions';
import { useDriverChatInbox } from '../../../features/trips/driverCockpit/useDriverChatInbox';
import { useDriverBackgroundLocation } from '../../../features/liveRide/backgroundLocation/useDriverBackgroundLocation';
import { DriverLiveCockpit } from '../../../features/trips/driverCockpit/DriverLiveCockpit';
import { DriverPostedTripView } from '../../../features/trips/driverCockpit/DriverPostedTripView';
import { CHAT_INQUIRY_PARAM } from '../../../features/notifications/pushRouting';
import { driverChatLinkDecision } from '../../../features/notifications/chatDeepLink';
import { useChatDeepLink } from '../../../features/notifications/useChatDeepLink';
import { ChatLinkUnavailableSheet } from '../../../features/notifications/ChatLinkUnavailableSheet';

export default function MyTripDetailScreen() {
  // chatInquiryId: set by a tapped chat push (features/notifications) — the
  // rider whose thread to open.
  const { id, chatInquiryId } = useLocalSearchParams<{ id: string; chatInquiryId?: string }>();
  const { user } = useAuth();
  const { data: trip, isLoading, isError, refetch } = useMyTrip(id);
  const {
    data: inquiriesRes,
    isLoading: inquiriesLoading,
    refetch: refetchInquiries,
  } = useTripInquiryInbox({ tripId: id as string });
  const updateInquiryStatus = useUpdateTripInquiryStatus();
  // Fetched (and cached by react-query) regardless of status — the backend
  // doesn't gate this on trip status either — so a manifest fetched earlier
  // while online is already sitting in cache if "Start trip" is later tapped
  // offline. Only the cockpit's own visibility is gated on effective status.
  // dataUpdatedAt: when this device received it — anchors the manifest's
  // serverNow for the cockpit's stop wait timers and no-show countdowns.
  const { data: manifest, isLoading: manifestLoading, dataUpdatedAt: manifestReceivedAt } = useTripManifest(id);
  const offlineQueue = useOfflineTripQueue(id, user?.id);
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
  // Keeps the driver's location reaching riders once they leave the app —
  // from the server's own IN_PROGRESS only (never an optimistic offline
  // start: the location endpoint refuses fixes until the start has synced).
  const backgroundLocation = useDriverBackgroundLocation({
    tripId: id as string,
    userId: user?.id,
    serverInProgress: trip?.status === TripStatus.IN_PROGRESS,
    tripOver:
      effectiveCompleted ||
      trip?.status === TripStatus.CANCELLED ||
      trip?.status === TripStatus.SUSPENDED,
    permissionGranted: location.permissionGranted,
    locationDenied: location.locationDenied,
  });
  const stopProgress = useDriverStopProgress({
    manifest,
    manifestReceivedAt,
    optimisticEvents: driverActions.optimisticEvents,
    noShowIds: driverActions.noShowIds,
    arrivedStopIds: driverActions.arrivedStopIds,
    currentPosition: location.currentPosition,
    active: effectiveInProgress,
  });
  const chat = useDriverChatInbox(user?.id);
  const showManifest = effectiveInProgress || effectiveCompleted;
  // A chat push's deep link: opens that rider's thread once the cockpit can
  // show it, or says why it can't (the trip hasn't started, the seat is gone).
  const chatLink = useChatDeepLink(
    CHAT_INQUIRY_PARAM,
    chatInquiryId,
    chatInquiryId
      ? driverChatLinkDecision({
          requestedInquiryId: chatInquiryId,
          tripStatus: trip?.status,
          cockpitShown: showManifest,
          manifestRiders: manifest?.riders,
          manifestLoading,
          inboxRiderName: inquiriesRes?.data.find((inquiry) => inquiry.id === chatInquiryId)?.user.name ?? null,
        })
      : { kind: 'wait' },
    (target) => chat.openChat(target.tripInquiryId, target.otherPartyName),
  );
  // Only wired into the pre-live posted-trip view below — the live cockpit is
  // kept current by the socket, the offline queue, and post-action refetches.
  const refresh = usePullToRefresh(() => Promise.all([refetch(), refetchInquiries()]));

  if (isLoading) return <LoadingState label="Loading trip..." />;
  if (isError || !trip) return <ErrorState message="Couldn't load this trip." onRetry={refetch} />;

  return (
    // While the ride lock hides the native header there's nothing above the
    // cockpit to clear the status bar / notch (the app draws edge-to-edge),
    // so the screen takes the top safe-area edge itself.
    <AppScreen edges={effectiveInProgress ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom']}>
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
          backgroundLocation={backgroundLocation}
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
          refreshControl={<AppRefreshControl {...refresh} />}
        />
      )}
      <ChatLinkUnavailableSheet notice={chatLink.notice} onClose={chatLink.dismissNotice} />
    </AppScreen>
  );
}
