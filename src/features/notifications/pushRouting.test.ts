import { describe, expect, it } from '@jest/globals';

import {
  RIDE_PUSH_DATA_VERSION,
  RIDE_PUSH_TYPES,
  USER_VEHICLE_PUSH_TYPES,
  activeRidePathname,
  hrefOf,
  legacyFallbackRoute,
  pushInvalidationKeys,
  pushNavigationStep,
  resolvePushTarget,
  routeForResolvedInquiry,
  type PushTarget,
} from './pushRouting';

const ME = 'user-me';
const OTHER = 'user-other';
const TRIP = 'trip-1';
const INQ = 'inq-1';

// Hand-copied from kerayego-backend src/modules/notifications/ride-push-data.ts
// (RIDE_PUSH_TYPES, RIDE_PUSH_DATA_VERSION) and
// src/modules/user-vehicles/user-vehicle-events.ts (USER_VEHICLE_DECISION_EVENTS).
const BACKEND_RIDE_PUSH_TYPES = [
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
];
const BACKEND_USER_VEHICLE_PUSH_TYPES = [
  'userVehicle.approved',
  'userVehicle.rejected',
  'userVehicle.suspended',
  'userVehicle.reactivated',
];

// What buildRidePushData sends (all strings, inquiryId mirroring tripInquiryId).
function v2(
  type: string,
  recipientRole: 'DRIVER' | 'RIDER',
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    v: '2',
    type,
    recipientRole,
    recipientUserId: ME,
    tripId: TRIP,
    tripInquiryId: INQ,
    inquiryId: INQ,
    ...extra,
  };
}

function route(pathname: string, params: Record<string, string> = {}): PushTarget {
  return { kind: 'route', route: { pathname, params } };
}

const DRIVER_TRIP = `/account/my-trips/${TRIP}`;
const RIDER_REQUEST = `/account/trip-request/${INQ}`;

describe('push type mirrors', () => {
  it('match the backend constants exactly', () => {
    expect([...RIDE_PUSH_TYPES]).toEqual(BACKEND_RIDE_PUSH_TYPES);
    expect([...USER_VEHICLE_PUSH_TYPES]).toEqual(BACKEND_USER_VEHICLE_PUSH_TYPES);
    expect(RIDE_PUSH_DATA_VERSION).toBe('2');
  });
});

describe('resolvePushTarget — v2 payloads (recipientRole)', () => {
  it.each(['tripInquiry.created', 'tripInquiry.riderCancelled', 'tripInquiry.accepted'])(
    'sends the DRIVER copy of %s to their trip',
    (type) => {
      expect(resolvePushTarget(v2(type, 'DRIVER'), ME)).toEqual(route(DRIVER_TRIP));
    },
  );

  it('opens the rider’s thread on the driver’s trip for a chat message', () => {
    expect(resolvePushTarget(v2('chat_message', 'DRIVER', { messageId: 'm1' }), ME)).toEqual(
      route(DRIVER_TRIP, { chatInquiryId: INQ }),
    );
  });

  it.each([
    'tripInquiry.accepted',
    'tripInquiry.rejected',
    'tripInquiry.cancelled',
    'trip.started',
    'trip.driverArrived',
    'trip.droppedOff',
    'trip.riderNoShow',
    'trip.nextPickupApproaching',
    'trip.completed',
  ])('sends the RIDER copy of %s to their request', (type) => {
    expect(resolvePushTarget(v2(type, 'RIDER', { stopId: 'stop-1' }), ME)).toEqual(route(RIDER_REQUEST));
  });

  it('opens the chat on the rider’s request for a chat message', () => {
    expect(resolvePushTarget(v2('chat_message', 'RIDER', { messageId: 'm1' }), ME)).toEqual(
      route(RIDER_REQUEST, { openChat: '1' }),
    );
  });

  it('tells the two copies of tripInquiry.accepted apart by role alone', () => {
    const rider = resolvePushTarget(v2('tripInquiry.accepted', 'RIDER'), ME);
    const driver = resolvePushTarget(v2('tripInquiry.accepted', 'DRIVER'), ME);
    expect(rider).toEqual(route(RIDER_REQUEST));
    expect(driver).toEqual(route(DRIVER_TRIP));
  });

  it('reads tripInquiryId when inquiryId is missing, and the other way round', () => {
    const { inquiryId: _dropped, ...withoutMirror } = v2('trip.completed', 'RIDER');
    expect(resolvePushTarget(withoutMirror, ME)).toEqual(route(RIDER_REQUEST));
    const { tripInquiryId: _gone, ...onlyMirror } = v2('trip.completed', 'RIDER');
    expect(resolvePushTarget(onlyMirror, ME)).toEqual(route(RIDER_REQUEST));
  });

  it('looks a DRIVER payload without tripId up by its request', () => {
    const { tripId: _missing, ...data } = v2('chat_message', 'DRIVER');
    expect(resolvePushTarget(data, ME)).toEqual({ kind: 'resolveInquiry', inquiryId: INQ, openChat: true, fallback: null });
  });

  it('does nothing for a RIDER payload without a request id', () => {
    const { tripInquiryId: _a, inquiryId: _b, ...data } = v2('trip.started', 'RIDER');
    expect(resolvePushTarget(data, ME)).toEqual({ kind: 'none' });
  });
});

describe('resolvePushTarget — a push addressed to someone else', () => {
  it.each([
    v2('chat_message', 'DRIVER'),
    v2('trip.riderNoShow', 'RIDER'),
    { type: 'trip.started', tripId: TRIP, tripInquiryId: INQ },
  ])('is ignored when recipientUserId is another user (%#)', (data) => {
    expect(resolvePushTarget({ ...data, recipientUserId: OTHER }, ME)).toEqual({ kind: 'none' });
  });
});

describe('resolvePushTarget — legacy payloads (no v, no recipientRole)', () => {
  it.each([
    ['trip.started', { type: 'trip.started', tripId: TRIP, tripInquiryId: INQ }],
    ['trip.driverArrived', { type: 'trip.driverArrived', tripId: TRIP, stopId: 's1', tripInquiryId: INQ }],
    ['trip.droppedOff', { type: 'trip.droppedOff', tripId: TRIP, tripInquiryId: INQ }],
    ['trip.nextPickupApproaching', { type: 'trip.nextPickupApproaching', tripId: TRIP, tripInquiryId: INQ }],
    ['trip.completed', { type: 'trip.completed', tripId: TRIP, tripInquiryId: INQ }],
    ['tripInquiry.rejected', { type: 'tripInquiry.rejected', inquiryId: INQ }],
    ['tripInquiry.cancelled', { type: 'tripInquiry.cancelled', inquiryId: INQ }],
  ])('keeps routing rider-only %s straight to the request', (_type, data) => {
    expect(resolvePushTarget(data, ME)).toEqual(route(RIDER_REQUEST));
  });

  it('looks up an old chat message — either side may have received it', () => {
    expect(resolvePushTarget({ type: 'chat_message', tripInquiryId: INQ, messageId: 'm1' }, ME)).toEqual({
      kind: 'resolveInquiry',
      inquiryId: INQ,
      openChat: true,
      fallback: { pathname: RIDER_REQUEST, params: {} },
    });
  });

  it('looks up an old tripInquiry.accepted — it went to both sides alike', () => {
    expect(resolvePushTarget({ type: 'tripInquiry.accepted', inquiryId: INQ }, ME)).toEqual({
      kind: 'resolveInquiry',
      inquiryId: INQ,
      openChat: false,
      fallback: { pathname: RIDER_REQUEST, params: {} },
    });
  });

  it.each(['tripInquiry.created', 'tripInquiry.riderCancelled'])(
    'looks up old driver-only %s for its trip, with no fallback (it never navigated)',
    (type) => {
      expect(resolvePushTarget({ type, inquiryId: INQ }, ME)).toEqual({
        kind: 'resolveInquiry',
        inquiryId: INQ,
        openChat: false,
        fallback: null,
      });
    },
  );

  it('does nothing without any id', () => {
    expect(resolvePushTarget({ type: 'chat_message', messageId: 'm1' }, ME)).toEqual({ kind: 'none' });
  });
});

describe('resolvePushTarget — vehicle decisions', () => {
  it.each(BACKEND_USER_VEHICLE_PUSH_TYPES)('opens the vehicle for %s', (type) => {
    expect(resolvePushTarget({ type, userVehicleId: 'veh-1' }, ME)).toEqual(route('/account/my-vehicles/veh-1'));
  });

  it('does nothing without a vehicle id', () => {
    expect(resolvePushTarget({ type: 'userVehicle.approved' }, ME)).toEqual({ kind: 'none' });
  });
});

describe('resolvePushTarget — anything else just opens the app', () => {
  it.each([
    ['the admin test broadcast', { type: 'test' }],
    ['an unknown type', { type: 'trip.somethingNew', tripId: TRIP, tripInquiryId: INQ, recipientRole: 'RIDER' }],
    ['no type', { tripId: TRIP, tripInquiryId: INQ }],
    ['a non-string type', { type: 42 }],
    ['an empty payload', {}],
    ['no payload', undefined],
    ['an array', ['trip.started']],
  ])('%s', (_label, data) => {
    expect(resolvePushTarget(data, ME)).toEqual({ kind: 'none' });
  });

  it('never builds a route from an id that isn’t a plain token', () => {
    expect(resolvePushTarget({ ...v2('trip.started', 'RIDER'), tripInquiryId: '../../login', inquiryId: '../../login' }, ME)).toEqual({
      kind: 'none',
    });
    expect(resolvePushTarget({ type: 'userVehicle.approved', userVehicleId: 'a/b' }, ME)).toEqual({ kind: 'none' });
  });

  it('ignores an unrecognised recipientRole and falls back to the type', () => {
    expect(resolvePushTarget({ ...v2('trip.completed', 'RIDER'), recipientRole: 'ADMIN' }, ME)).toEqual(route(RIDER_REQUEST));
  });
});

describe('routeForResolvedInquiry', () => {
  const inquiry = { id: INQ, trip: { id: TRIP, postedByUserId: ME } };

  it('sends the trip’s poster to their trip, with the chat when asked', () => {
    expect(routeForResolvedInquiry(inquiry, ME, false)).toEqual({ pathname: DRIVER_TRIP, params: {} });
    expect(routeForResolvedInquiry(inquiry, ME, true)).toEqual({ pathname: DRIVER_TRIP, params: { chatInquiryId: INQ } });
  });

  it('sends anyone else (the rider) to the request', () => {
    const ridersInquiry = { ...inquiry, trip: { ...inquiry.trip, postedByUserId: OTHER } };
    expect(routeForResolvedInquiry(ridersInquiry, ME, false)).toEqual({ pathname: RIDER_REQUEST, params: {} });
    expect(routeForResolvedInquiry(ridersInquiry, ME, true)).toEqual({ pathname: RIDER_REQUEST, params: { openChat: '1' } });
  });
});

describe('legacyFallbackRoute', () => {
  const target = { kind: 'resolveInquiry', inquiryId: INQ, openChat: true, fallback: { pathname: RIDER_REQUEST, params: {} } } as const;

  it.each(['not_found', 'forbidden', 'unauthorized'] as const)('stays put on %s — that screen would fail too', (kind) => {
    expect(legacyFallbackRoute(target, kind)).toBeNull();
  });

  it.each(['network', 'server', 'rate_limited', 'unknown'] as const)('falls back to the old destination on %s', (kind) => {
    expect(legacyFallbackRoute(target, kind)).toEqual(target.fallback);
  });
});

describe('hrefOf / pushNavigationStep', () => {
  it('builds the href with encoded query params', () => {
    expect(hrefOf({ pathname: DRIVER_TRIP, params: {} })).toBe(DRIVER_TRIP);
    expect(hrefOf({ pathname: DRIVER_TRIP, params: { chatInquiryId: 'a b&c' } })).toBe(`${DRIVER_TRIP}?chatInquiryId=a%20b%26c`);
  });

  it('pushes a screen that isn’t the current one', () => {
    expect(pushNavigationStep({ pathname: DRIVER_TRIP, params: { chatInquiryId: INQ } }, '/')).toEqual({
      kind: 'push',
      href: `${DRIVER_TRIP}?chatInquiryId=${INQ}`,
    });
  });

  it('pushes another trip’s screen rather than swapping it into this one', () => {
    expect(pushNavigationStep({ pathname: '/account/my-trips/trip-2', params: {} }, DRIVER_TRIP)).toEqual({
      kind: 'push',
      href: '/account/my-trips/trip-2',
    });
  });

  it('hands the current screen its new params instead of stacking a copy', () => {
    expect(pushNavigationStep({ pathname: DRIVER_TRIP, params: { chatInquiryId: INQ } }, DRIVER_TRIP)).toEqual({
      kind: 'setParams',
      params: { chatInquiryId: INQ },
    });
  });

  it('does nothing when already exactly there', () => {
    expect(pushNavigationStep({ pathname: RIDER_REQUEST, params: {} }, RIDER_REQUEST)).toEqual({ kind: 'none' });
  });

  it('mid-ride, opens the chat on the locked ride screen itself', () => {
    expect(pushNavigationStep({ pathname: DRIVER_TRIP, params: { chatInquiryId: INQ } }, DRIVER_TRIP, DRIVER_TRIP)).toEqual({
      kind: 'setParams',
      params: { chatInquiryId: INQ },
    });
    expect(pushNavigationStep({ pathname: DRIVER_TRIP, params: { chatInquiryId: INQ } }, '/', DRIVER_TRIP)).toEqual({
      kind: 'push',
      href: `${DRIVER_TRIP}?chatInquiryId=${INQ}`,
    });
  });

  it('mid-ride, stays put for any other screen — the ride lock would bounce it back', () => {
    expect(pushNavigationStep({ pathname: '/account/my-trips/trip-2', params: {} }, DRIVER_TRIP, DRIVER_TRIP)).toEqual({
      kind: 'none',
    });
    expect(pushNavigationStep({ pathname: '/account/my-vehicles/veh-1', params: {} }, RIDER_REQUEST, RIDER_REQUEST)).toEqual({
      kind: 'none',
    });
  });
});

describe('activeRidePathname', () => {
  it('is the driver’s trip or the rider’s request, as the ride lock holds them', () => {
    expect(activeRidePathname({ role: 'driver', tripId: TRIP })).toBe(DRIVER_TRIP);
    expect(activeRidePathname({ role: 'rider', tripId: TRIP, tripInquiryId: INQ })).toBe(RIDER_REQUEST);
  });

  it('is null without an active ride', () => {
    expect(activeRidePathname(null)).toBeNull();
    expect(activeRidePathname(undefined)).toBeNull();
  });
});

describe('pushInvalidationKeys', () => {
  it('refreshes the rider’s request and the ride lock for a rider push (e.g. a no-show mark)', () => {
    expect(pushInvalidationKeys(v2('trip.riderNoShow', 'RIDER'), ME)).toEqual([
      ['tripInquiry', INQ],
      ['myTripInquiries'],
      ['myActiveRide'],
    ]);
  });

  it('refreshes the driver’s trip, manifest and inbox for a driver push', () => {
    expect(pushInvalidationKeys(v2('tripInquiry.riderCancelled', 'DRIVER'), ME)).toEqual([
      ['tripInquiryInbox'],
      ['myTrip', TRIP],
      ['tripManifest', TRIP],
      ['myTrips'],
      ['myActiveRide'],
    ]);
  });

  it('infers the side of an older payload from its type', () => {
    expect(pushInvalidationKeys({ type: 'trip.droppedOff', tripId: TRIP, tripInquiryId: INQ }, ME)).toEqual([
      ['tripInquiry', INQ],
      ['myTripInquiries'],
      ['myActiveRide'],
    ]);
    expect(pushInvalidationKeys({ type: 'tripInquiry.created', inquiryId: INQ }, ME)).toEqual([
      ['tripInquiryInbox'],
      ['myTrip'],
      ['tripManifest'],
      ['myTrips'],
      ['myActiveRide'],
    ]);
  });

  it('refreshes both sides for an older tripInquiry.accepted', () => {
    expect(pushInvalidationKeys({ type: 'tripInquiry.accepted', inquiryId: INQ }, ME)).toEqual([
      ['tripInquiry', INQ],
      ['myTripInquiries'],
      ['myActiveRide'],
      ['tripInquiryInbox'],
      ['myTrip'],
      ['tripManifest'],
      ['myTrips'],
    ]);
  });

  it('refreshes the vehicles for a vehicle decision', () => {
    expect(pushInvalidationKeys({ type: 'userVehicle.rejected', userVehicleId: 'veh-1' }, ME)).toEqual([['userVehicles']]);
  });

  it('refreshes nothing for chat, unknown types or another user’s push', () => {
    expect(pushInvalidationKeys(v2('chat_message', 'RIDER'), ME)).toEqual([]);
    expect(pushInvalidationKeys({ type: 'test' }, ME)).toEqual([]);
    expect(pushInvalidationKeys({ ...v2('trip.completed', 'RIDER'), recipientUserId: OTHER }, ME)).toEqual([]);
    expect(pushInvalidationKeys(null, ME)).toEqual([]);
  });
});
