import { TripStatus } from '../../types/enums';
import type { RiderSeatStage } from '../trip-inquiries/riderLiveTrip/riderTripState';

// What a trip screen does with a chat push's deep link (?chatInquiryId= on
// the driver's trip, ?openChat=1 on the rider's request — see pushRouting.ts):
// open that thread where the screen offers chat, or say why it can't. Chat
// is only offered during the ride (whether it opens before or after is an
// open product decision), so a link that lands outside it explains itself
// instead of silently doing nothing.

export type ChatLinkDecision =
  // The screen hasn't loaded what it needs to decide yet.
  | { kind: 'wait' }
  | { kind: 'open'; tripInquiryId: string; otherPartyName: string }
  | { kind: 'unavailable'; message: string };

interface DriverChatLinkInput {
  requestedInquiryId: string;
  // Undefined until the trip has loaded.
  tripStatus: TripStatus | undefined;
  // The live cockpit — the driver's only screen with chat — is on show
  // (trip in progress or just completed).
  cockpitShown: boolean;
  // The manifest's riders: undefined until it has loaded (or if it failed).
  manifestRiders: { id: string; user: { name: string } }[] | undefined;
  manifestLoading: boolean;
  // The rider's name from the trip's seat requests, when known.
  inboxRiderName: string | null;
}

export function driverChatLinkDecision({
  requestedInquiryId,
  tripStatus,
  cockpitShown,
  manifestRiders,
  manifestLoading,
  inboxRiderName,
}: DriverChatLinkInput): ChatLinkDecision {
  if (!tripStatus) return { kind: 'wait' };

  if (cockpitShown) {
    if (!manifestRiders) {
      if (manifestLoading) return { kind: 'wait' };
      // No manifest to check the seat against — open anyway; the thread
      // reports its own error if the seat is gone.
      return { kind: 'open', tripInquiryId: requestedInquiryId, otherPartyName: inboxRiderName ?? 'Rider' };
    }
    const rider = manifestRiders.find((r) => r.id === requestedInquiryId);
    if (rider) return { kind: 'open', tripInquiryId: rider.id, otherPartyName: rider.user.name };
    return {
      kind: 'unavailable',
      message: `${inboxRiderName ?? 'This rider'} no longer has a confirmed seat on this trip, so their chat is closed.`,
    };
  }

  if (tripStatus === TripStatus.ACTIVE) {
    return {
      kind: 'unavailable',
      message: `Chat with ${inboxRiderName ?? 'your riders'} opens once you start the trip.`,
    };
  }
  return { kind: 'unavailable', message: "This trip isn't running, so its chats are closed." };
}

// Where the rider's screen offers chat: the live ride, and the no-show card
// while the trip is still running (so they can sort it out with the driver).
export function riderChatAvailable(stage: RiderSeatStage, tripStatus: TripStatus): boolean {
  return stage === 'live' || (stage === 'noShow' && tripStatus === TripStatus.IN_PROGRESS);
}

interface RiderChatLinkInput {
  tripInquiryId: string;
  // Null until the request has loaded.
  stage: RiderSeatStage | null;
  tripStatus: TripStatus | undefined;
  driverName: string;
}

export function riderChatLinkDecision({ tripInquiryId, stage, tripStatus, driverName }: RiderChatLinkInput): ChatLinkDecision {
  if (!stage || !tripStatus) return { kind: 'wait' };
  if (riderChatAvailable(stage, tripStatus)) {
    return { kind: 'open', tripInquiryId, otherPartyName: driverName };
  }
  if (stage === 'upcoming') {
    return {
      kind: 'unavailable',
      message: `Chat with ${driverName} opens once the trip starts. Until then, you can call or WhatsApp them from this screen.`,
    };
  }
  return { kind: 'unavailable', message: 'In-app chat is only available while your ride is under way.' };
}
