import { useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { Edge } from 'react-native-safe-area-context';

import { useAuth } from '../../../auth/auth-context';
import { useReleaseRiderActiveRide, useTripInquiry } from '../../../features/trip-inquiries/queries';
import { useOfflineTripQueue } from '../../../features/trips/offlineSync';
import { useRideSocket } from '../../../features/liveRide/socket';
import { useTripRoomPresence } from '../../../features/liveRide/useTripRoomPresence';
import { useBlockBackButtonWhileActive } from '../../../features/liveRide/useBlockBackButtonWhileActive';
import { AppRefreshControl, AppScreen, ErrorState, LoadingState } from '../../../components/ui';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { serverClockFrom } from '../../../features/trips/driverCockpit/noShow';
import { useRiderLiveRoute } from '../../../features/trip-inquiries/riderLiveTrip/useRiderLiveRoute';
import { useRiderTripActions } from '../../../features/trip-inquiries/riderLiveTrip/useRiderTripActions';
import { computeRideActionAvailability } from '../../../features/trip-inquiries/riderLiveTrip/rideActionAvailability';
import { riderSeatActions, riderSeatStage } from '../../../features/trip-inquiries/riderLiveTrip/riderTripState';
import { hasCoordinates } from '../../../features/trip-inquiries/riderLiveTrip/routeStops';
import { RiderPreLiveView } from '../../../features/trip-inquiries/riderLiveTrip/RiderPreLiveView';
import { RiderLiveView } from '../../../features/trip-inquiries/riderLiveTrip/RiderLiveView';
import { OPEN_CHAT_PARAM } from '../../../features/notifications/pushRouting';
import { riderChatAvailable, riderChatLinkDecision } from '../../../features/notifications/chatDeepLink';
import { useChatDeepLink } from '../../../features/notifications/useChatDeepLink';
import { ChatLinkUnavailableSheet } from '../../../features/notifications/ChatLinkUnavailableSheet';

const EDGES_WITH_HEADER: Edge[] = ['left', 'right', 'bottom'];
// No native header above the screen while the ride is locked — the screen
// clears the status bar / notch itself.
const EDGES_WITHOUT_HEADER: Edge[] = ['top', 'left', 'right', 'bottom'];

export default function MyTripRequestDetailScreen() {
  // openChat: set by a tapped chat push (features/notifications).
  const { id, openChat } = useLocalSearchParams<{ id: string; openChat?: string }>();
  const { user } = useAuth();
  const { data: inquiry, isLoading, isError, refetch, dataUpdatedAt } = useTripInquiry(id);
  const offlineQueue = useOfflineTripQueue(inquiry?.trip.id, user?.id);
  const { isConnected } = useRideSocket();

  // Where this seat stands, from the server's fields alone — see
  // riderSeatStage. null until the request has loaded.
  const stage = inquiry
    ? riderSeatStage({
        inquiryStatus: inquiry.status,
        tripStatus: inquiry.trip.status,
        droppedOffAt: inquiry.droppedOffAt,
        noShowAt: inquiry.noShowAt,
      })
    : null;
  // The ride lock, mirroring the driver cockpit's: only while this rider is
  // actually on the ride — accepted, trip running, not yet dropped off or
  // marked a no-show. It also gates every bit of live work (GPS watch, the
  // trip's socket room, driver location, ETA fetches), so all of it stops the
  // moment the rider is dropped off even though the trip runs on.
  const rideLocked = stage === 'live';
  const pickupStop = inquiry?.pickupStop ?? null;
  const dropoffStop = inquiry?.dropoffStop ?? null;
  // The server's clock as of this response (newer backend) — "driver arrived
  // N min ago" and the departure countdown read it instead of the phone's.
  const serverClock = serverClockFrom(inquiry?.serverNow, dataUpdatedAt);

  const route = useRiderLiveRoute({
    tripId: inquiry?.trip.id,
    rideLive: rideLocked,
    pickupStop,
    dropoffStop,
    pickupConfirmedAt: inquiry?.pickupConfirmedAt ?? null,
    routeStops: inquiry?.trip.stops,
  });
  const riderActions = useRiderTripActions({
    inquiryId: id as string,
    tripId: inquiry?.trip.id ?? '',
    rideLive: rideLocked,
    offlineQueue,
    position: route.position,
    refetch,
  });

  useTripRoomPresence(inquiry?.trip.id, rideLocked);
  useBlockBackButtonWhileActive(rideLocked);
  useReleaseRiderActiveRide(id, stage === null ? null : rideLocked);
  // Only wired into the scrolling (not live) view below — the live view is
  // kept current by the socket and this query's own 20s polling.
  const refresh = usePullToRefresh(refetch);

  // The chat sheet's state lives here, above both views, so a chat push's
  // deep link can open it whichever view is showing. It only shows where
  // chat is offered — the live ride, and the no-show card while the trip
  // still runs.
  const [chatOpen, setChatOpen] = useState(false);
  const chatAvailable = !!inquiry && !!stage && riderChatAvailable(stage, inquiry.trip.status);
  const chatLink = useChatDeepLink(
    OPEN_CHAT_PARAM,
    openChat,
    openChat
      ? riderChatLinkDecision({
          tripInquiryId: inquiry?.id ?? (id as string),
          stage,
          tripStatus: inquiry?.trip.status,
          driverName: inquiry?.trip.postedBy.name ?? 'your driver',
        })
      : { kind: 'wait' },
    () => setChatOpen(true),
  );
  const chatProps = {
    chatOpen: chatOpen && chatAvailable,
    onOpenChat: () => setChatOpen(true),
    onCloseChat: () => setChatOpen(false),
  };
  const chatLinkSheet = <ChatLinkUnavailableSheet notice={chatLink.notice} onClose={chatLink.dismissNotice} />;

  // One screen-level set of options for every state, so they can't conflict
  // as the views swap: while the ride is locked there's no header (so no
  // back chevron) and no swipe-back — the hardware back button is swallowed
  // above — and both come back the moment the lock releases.
  const screenOptions = (
    <Stack.Screen options={{ title: 'Trip request', headerShown: !rideLocked, gestureEnabled: !rideLocked }} />
  );
  const edges = rideLocked ? EDGES_WITHOUT_HEADER : EDGES_WITH_HEADER;

  if (isLoading || isError || !inquiry || !stage) {
    return (
      <AppScreen edges={edges}>
        {screenOptions}
        {isLoading ? (
          <LoadingState label="Loading request..." />
        ) : (
          <ErrorState message="Couldn't load this request." onRetry={refetch} />
        )}
      </AppScreen>
    );
  }

  const availableActions = riderSeatActions(stage, inquiry.status, inquiry.trip.status);

  if (!rideLocked) {
    return (
      <AppScreen edges={edges}>
        {screenOptions}
        <RiderPreLiveView
          inquiry={inquiry}
          stage={stage}
          availableActions={availableActions}
          riderActions={riderActions}
          offlineQueue={offlineQueue}
          serverClock={serverClock}
          refreshControl={<AppRefreshControl {...refresh} />}
          {...chatProps}
        />
        {chatLinkSheet}
      </AppScreen>
    );
  }

  const rideActionAvailability = computeRideActionAvailability({
    inquiryStatus: inquiry.status,
    tripStatus: inquiry.trip.status,
    pickupConfirmedAt: inquiry.pickupConfirmedAt,
    // A drop-off the rider already reported (queued offline, or awaiting the
    // refetch) hides Complete ride instead of inviting a second one.
    droppedOffAt: inquiry.droppedOffAt ?? riderActions.optimisticDroppedOffAt,
    noShowAt: inquiry.noShowAt,
    pickupStopLocated: hasCoordinates(pickupStop),
    dropoffStopLocated: hasCoordinates(dropoffStop),
    pickupDistanceM: route.pickupDistanceM,
    dropoffDistanceM: route.dropoffDistanceM,
    locationDenied: route.locationDenied,
    hasPosition: !!route.position,
  });

  return (
    <AppScreen edges={edges}>
      {screenOptions}
      <RiderLiveView
        inquiry={inquiry}
        pickupStop={pickupStop}
        dropoffStop={dropoffStop}
        availableActions={availableActions}
        isConnected={isConnected}
        route={route}
        riderActions={riderActions}
        rideActionAvailability={rideActionAvailability}
        offlineQueue={offlineQueue}
        serverClock={serverClock}
        {...chatProps}
      />
      {chatLinkSheet}
    </AppScreen>
  );
}
