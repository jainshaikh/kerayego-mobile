import type { ApiErrorKind } from '../../api/errors';
import type { MyActiveRide } from '../../api/trips.api';
import type { PushRecipientRole, RidePushType, UserVehiclePushType } from '../../types/api.types';

// Where a tapped push should take the user — pure, so the whole routing table
// is unit-tested (pushRouting.test.ts). usePushTapNavigation does the actual
// navigating, the legacy inquiry lookup and the query invalidation.

// Mirrors RIDE_PUSH_TYPES / RIDE_PUSH_DATA_VERSION in kerayego-backend
// src/modules/notifications/ride-push-data.ts.
export const RIDE_PUSH_TYPES = [
  'tripInquiry.created',
  'tripInquiry.accepted',
  'tripInquiry.rejected',
  'tripInquiry.cancelled',
  'tripInquiry.riderCancelled',
  'chat_message',
  'trip.started',
  'trip.driverArrived',
  'trip.droppedOff',
  'trip.riderNoShow',
  'trip.nextPickupApproaching',
  'trip.completed',
] as const satisfies readonly RidePushType[];

export const RIDE_PUSH_DATA_VERSION = '2';

// Mirrors USER_VEHICLE_DECISION_EVENTS in kerayego-backend
// src/modules/user-vehicles/user-vehicle-events.ts (the push type is the
// event name).
export const USER_VEHICLE_PUSH_TYPES = [
  'userVehicle.approved',
  'userVehicle.rejected',
  'userVehicle.suspended',
  'userVehicle.reactivated',
] as const satisfies readonly UserVehiclePushType[];

// Only ever sent to the rider, so an older payload without recipientRole
// still has exactly one right destination.
const RIDER_ONLY_TYPES: ReadonlySet<string> = new Set<RidePushType>([
  'tripInquiry.rejected',
  'tripInquiry.cancelled',
  'trip.started',
  'trip.driverArrived',
  'trip.droppedOff',
  'trip.riderNoShow',
  'trip.nextPickupApproaching',
  'trip.completed',
]);

// Only ever sent to the driver — but an older payload carried no tripId, so
// it can't reach the driver's trip screen without looking the request up.
const DRIVER_ONLY_TYPES: ReadonlySet<string> = new Set<RidePushType>([
  'tripInquiry.created',
  'tripInquiry.riderCancelled',
]);

const RIDE_TYPES: ReadonlySet<string> = new Set<string>(RIDE_PUSH_TYPES);
const USER_VEHICLE_TYPES: ReadonlySet<string> = new Set<string>(USER_VEHICLE_PUSH_TYPES);

// Route params a destination screen reads to open a chat thread straight away
// (see chatDeepLink.ts). Query params, not path segments: the active-ride lock
// (_layout.tsx) compares pathnames only, so they survive it.
export const CHAT_INQUIRY_PARAM = 'chatInquiryId';
export const OPEN_CHAT_PARAM = 'openChat';

export interface PushRoute {
  pathname: string;
  params: Record<string, string>;
}

export type PushTarget =
  | { kind: 'route'; route: PushRoute }
  // An older backend's payload that doesn't say which side of the trip the
  // recipient is on (or which trip): GET /trip-inquiries/:id answers both
  // (it authorizes the rider and the trip's driver). `fallback` is where the
  // tap went before this routing existed, for when that lookup fails.
  | { kind: 'resolveInquiry'; inquiryId: string; openChat: boolean; fallback: PushRoute | null }
  // Stale (another account's), unknown or incomplete — just open the app.
  | { kind: 'none' };

export function driverTripRoute(tripId: string, chatInquiryId?: string): PushRoute {
  return { pathname: `/account/my-trips/${tripId}`, params: chatInquiryId ? { [CHAT_INQUIRY_PARAM]: chatInquiryId } : {} };
}

export function riderRequestRoute(tripInquiryId: string, openChat = false): PushRoute {
  return { pathname: `/account/trip-request/${tripInquiryId}`, params: openChat ? { [OPEN_CHAT_PARAM]: '1' } : {} };
}

export function userVehicleRoute(userVehicleId: string): PushRoute {
  return { pathname: `/account/my-vehicles/${userVehicleId}`, params: {} };
}

// Ids become path segments, so anything that isn't a plain uuid/cuid-style
// token is treated as absent rather than built into a route.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readId(data: Record<string, unknown>, key: string): string | undefined {
  const value = readString(data, key);
  return value && SAFE_ID.test(value) ? value : undefined;
}

function readRole(data: Record<string, unknown>): PushRecipientRole | undefined {
  const role = data.recipientRole;
  return role === 'DRIVER' || role === 'RIDER' ? role : undefined;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

/**
 * The destination for a tapped push, for the signed-in user `currentUserId`:
 * - a payload addressed to someone else (recipientUserId) → nothing — the
 *   device's token was re-pointed to this account after it was sent;
 * - userVehicle.* → that vehicle's screen;
 * - a ride push with recipientRole (newer backend): DRIVER → their trip
 *   (with the rider's chat for chat_message), RIDER → their request (with
 *   the chat open for chat_message);
 * - an older ride push: rider-only types go straight to the rider's request
 *   (as before); chat_message, tripInquiry.accepted (sent to both sides) and
 *   the driver-only types are resolved by looking the request up;
 * - anything else ('test', unknown types, missing ids) → nothing.
 */
export function resolvePushTarget(rawData: unknown, currentUserId: string): PushTarget {
  const data = asRecord(rawData);
  const type = data ? readString(data, 'type') : undefined;
  if (!data || !type) return { kind: 'none' };

  const recipientUserId = readString(data, 'recipientUserId');
  if (recipientUserId !== undefined && recipientUserId !== currentUserId) return { kind: 'none' };

  if (USER_VEHICLE_TYPES.has(type)) {
    const userVehicleId = readId(data, 'userVehicleId');
    return userVehicleId ? { kind: 'route', route: userVehicleRoute(userVehicleId) } : { kind: 'none' };
  }
  if (!RIDE_TYPES.has(type)) return { kind: 'none' };

  const isChat = type === 'chat_message';
  const tripId = readId(data, 'tripId');
  // tripInquiry.* used `inquiryId`, chat and trip.* `tripInquiryId`; a newer
  // backend sends both.
  const inquiryId = readId(data, 'tripInquiryId') ?? readId(data, 'inquiryId');

  const role = readRole(data);
  if (role === 'DRIVER') {
    if (tripId) return { kind: 'route', route: driverTripRoute(tripId, isChat ? inquiryId : undefined) };
    return inquiryId ? { kind: 'resolveInquiry', inquiryId, openChat: isChat, fallback: null } : { kind: 'none' };
  }
  if (role === 'RIDER') {
    return inquiryId ? { kind: 'route', route: riderRequestRoute(inquiryId, isChat) } : { kind: 'none' };
  }

  // An older backend's payload — no recipientRole.
  if (RIDER_ONLY_TYPES.has(type)) {
    return inquiryId ? { kind: 'route', route: riderRequestRoute(inquiryId) } : { kind: 'none' };
  }
  if (DRIVER_ONLY_TYPES.has(type) && tripId) {
    return { kind: 'route', route: driverTripRoute(tripId) };
  }
  if (!inquiryId) return { kind: 'none' };
  return {
    kind: 'resolveInquiry',
    inquiryId,
    openChat: isChat,
    // Before this routing, chat_message and tripInquiry.accepted always went
    // to the rider's request screen and the driver-only types nowhere.
    fallback: DRIVER_ONLY_TYPES.has(type) ? null : riderRequestRoute(inquiryId),
  };
}

/** Where an older payload goes once its request has been looked up: the driver to their trip, the rider to their request. */
export function routeForResolvedInquiry(
  inquiry: { id: string; trip: { id: string; postedByUserId: string } },
  currentUserId: string,
  openChat: boolean,
): PushRoute {
  if (inquiry.trip.postedByUserId === currentUserId) {
    return driverTripRoute(inquiry.trip.id, openChat ? inquiry.id : undefined);
  }
  return riderRequestRoute(inquiry.id, openChat);
}

/**
 * Where an older payload goes when looking its request up failed. A refusal
 * (gone, not ours, signed out) means its screen would fail too — stay put;
 * no answer (offline, server error) falls back to where the tap used to go.
 */
export function legacyFallbackRoute(
  target: Extract<PushTarget, { kind: 'resolveInquiry' }>,
  errorKind: ApiErrorKind,
): PushRoute | null {
  if (errorKind === 'not_found' || errorKind === 'forbidden' || errorKind === 'unauthorized') return null;
  return target.fallback;
}

export function hrefOf(route: PushRoute): string {
  const query = Object.entries(route.params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${route.pathname}?${query}` : route.pathname;
}

/**
 * The screen the active-ride lock (useActiveRideLock, app/_layout.tsx) holds
 * the user on during a ride, or null when they have no active ride.
 */
export function activeRidePathname(activeRide: MyActiveRide | undefined): string | null {
  if (!activeRide) return null;
  return activeRide.role === 'driver'
    ? `/account/my-trips/${activeRide.tripId}`
    : `/account/trip-request/${activeRide.tripInquiryId}`;
}

export type PushNavigationStep =
  | { kind: 'push'; href: string }
  | { kind: 'setParams'; params: Record<string, string> }
  | { kind: 'none' };

/**
 * How to get from the current screen to a push's route:
 * - mid-ride, anywhere but the locked ride screen → stay: the lock would
 *   replace the pushed screen with a second copy of the ride screen still
 *   open underneath;
 * - already on that screen (a re-tap, or a chat push for the trip being
 *   driven) → just hand it the new params, so it opens the chat in place
 *   instead of stacking a copy of itself;
 * - anywhere else → push it. Another trip's screen is pushed, never swapped
 *   into the one on show.
 */
export function pushNavigationStep(
  route: PushRoute,
  currentPathname: string,
  lockedPathname: string | null = null,
): PushNavigationStep {
  if (lockedPathname !== null && route.pathname !== lockedPathname) return { kind: 'none' };
  if (route.pathname === currentPathname) {
    return Object.keys(route.params).length > 0 ? { kind: 'setParams', params: route.params } : { kind: 'none' };
  }
  return { kind: 'push', href: hrefOf(route) };
}

/**
 * The cached queries a push says are out of date, so a screen already
 * showing them catches up now instead of on its next poll (the no-show mark,
 * a drop-off, a cancelled seat, a new request). Prefix keys — react-query
 * matches every query under them. Nothing for chat (an open thread gets its
 * messages over the socket) or for someone else's push.
 */
export function pushInvalidationKeys(rawData: unknown, currentUserId: string): (readonly unknown[])[] {
  const data = asRecord(rawData);
  const type = data ? readString(data, 'type') : undefined;
  if (!data || !type) return [];
  const recipientUserId = readString(data, 'recipientUserId');
  if (recipientUserId !== undefined && recipientUserId !== currentUserId) return [];

  if (USER_VEHICLE_TYPES.has(type)) return [['userVehicles']];
  if (!RIDE_TYPES.has(type) || type === 'chat_message') return [];

  const tripId = readId(data, 'tripId');
  const inquiryId = readId(data, 'tripInquiryId') ?? readId(data, 'inquiryId');
  const role =
    readRole(data) ?? (RIDER_ONLY_TYPES.has(type) ? 'RIDER' : DRIVER_ONLY_TYPES.has(type) ? 'DRIVER' : undefined);

  const riderKeys: (readonly unknown[])[] = [
    inquiryId ? ['tripInquiry', inquiryId] : ['tripInquiry'],
    ['myTripInquiries'],
    ['myActiveRide'],
  ];
  const driverKeys: (readonly unknown[])[] = [
    ['tripInquiryInbox'],
    tripId ? ['myTrip', tripId] : ['myTrip'],
    tripId ? ['tripManifest', tripId] : ['tripManifest'],
    ['myTrips'],
    ['myActiveRide'],
  ];
  if (role === 'RIDER') return riderKeys;
  if (role === 'DRIVER') return driverKeys;
  // tripInquiry.accepted from an older backend reached both sides alike.
  return [...riderKeys, ...driverKeys.filter((key) => key[0] !== 'myActiveRide')];
}
