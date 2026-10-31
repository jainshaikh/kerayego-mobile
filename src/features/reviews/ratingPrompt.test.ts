import { describe, expect, it } from '@jest/globals';

import type { EligibleBooking, EligibleForReview, EligibleTrip } from '../../api/reviews.api';
import { CAR_LABEL, DRIVER_LABEL, type PendingRating } from './rateTargets';
import {
  buildReviewPayloads,
  customerBookingPendingRating,
  driverTripPendingRatings,
  isLockRedirectPending,
  riderTripPendingRating,
  shouldAutoOpenRatingPrompt,
  type RatingPromptFacts,
} from './ratingPrompt';

const driverRow = (id: string, tripId: string, name = `Rider ${id}`): EligibleTrip => ({
  id,
  trip: { id: tripId, originCity: 'lahore', destinationCity: 'islamabad' },
  user: { id: `user-${id}`, name },
});

const riderRow = (id: string, over: Partial<EligibleTrip['trip']> = {}): EligibleTrip => ({
  id,
  trip: {
    id: 't-1',
    originCity: 'lahore',
    destinationCity: 'islamabad',
    userVehicleId: 'uv-1',
    fleetVehicleId: null,
    isReturnTrip: false,
    postedByUserId: 'driver-1',
    ...over,
  },
});

const bookingRow = (id: string, over: Partial<EligibleBooking> = {}): EligibleBooking => ({
  id,
  vehicle: { id: 'v-1', title: 'Corolla', slug: 'corolla' },
  assignedDriverId: 'drv-1',
  assignedDriver: { id: 'drv-1', name: 'ali', driverProfile: null },
  ...over,
});

const eligible = (over: Partial<EligibleForReview> = {}): EligibleForReview => ({
  bookingsAsCustomer: [],
  bookingsAsProvider: [],
  tripsAsRider: [],
  tripsAsDriver: [],
  ...over,
});

describe('driverTripPendingRatings', () => {
  const data = eligible({
    tripsAsDriver: [driverRow('ti-1', 't-1', 'Sara'), driverRow('ti-2', 't-2'), driverRow('ti-3', 't-1', 'Omar')],
  });

  it("lists only this trip's riders, one rating (one POST) each, labelled by name", () => {
    expect(driverTripPendingRatings(data, 't-1')).toEqual([
      {
        context: 'TRIP_INQUIRY',
        contextId: 'ti-1',
        title: 'Rate rider: Sara',
        targets: [{ subjectType: 'USER', subjectId: 'user-ti-1', label: 'Sara' }],
      },
      {
        context: 'TRIP_INQUIRY',
        contextId: 'ti-3',
        title: 'Rate rider: Omar',
        targets: [{ subjectType: 'USER', subjectId: 'user-ti-3', label: 'Omar' }],
      },
    ]);
  });

  it('drops riders known to be no-shows since the list was fetched', () => {
    expect(driverTripPendingRatings(data, 't-1', ['ti-1']).map((p) => p.contextId)).toEqual(['ti-3']);
  });

  it('is empty before the list loads, for another trip, or for a row without a rider', () => {
    expect(driverTripPendingRatings(undefined, 't-1')).toEqual([]);
    expect(driverTripPendingRatings(data, 't-9')).toEqual([]);
    const noUser: EligibleTrip = { id: 'ti-4', trip: { id: 't-1', originCity: 'a', destinationCity: 'b' } };
    expect(driverTripPendingRatings(eligible({ tripsAsDriver: [noUser] }), 't-1')).toEqual([]);
  });

  it('falls back to "Rider" for a blank name', () => {
    const blank = eligible({ tripsAsDriver: [driverRow('ti-5', 't-1', '  ')] });
    expect(driverTripPendingRatings(blank, 't-1')[0].targets[0].label).toBe('Rider');
  });
});

describe('riderTripPendingRating', () => {
  it("finds this seat and rates the driver's car and the driver", () => {
    const pending = riderTripPendingRating(eligible({ tripsAsRider: [riderRow('ti-9'), riderRow('ti-1')] }), 'ti-1');
    expect(pending?.contextId).toBe('ti-1');
    expect(pending?.targets).toEqual([
      { subjectType: 'USER_VEHICLE', subjectId: 'uv-1', label: CAR_LABEL },
      { subjectType: 'USER', subjectId: 'driver-1', label: DRIVER_LABEL },
    ]);
  });

  it("rates a business return trip's fleet car", () => {
    const row = riderRow('ti-1', { isReturnTrip: true, userVehicleId: null, fleetVehicleId: 'fleet-1' });
    expect(riderTripPendingRating(eligible({ tripsAsRider: [row] }), 'ti-1')?.targets[0]).toEqual({
      subjectType: 'VEHICLE',
      subjectId: 'fleet-1',
      label: CAR_LABEL,
    });
  });

  it('is null once the seat is no longer listed (rated, or a no-show) or before the list loads', () => {
    expect(riderTripPendingRating(eligible({ tripsAsRider: [riderRow('ti-2')] }), 'ti-1')).toBeNull();
    expect(riderTripPendingRating(undefined, 'ti-1')).toBeNull();
  });
});

describe('customerBookingPendingRating', () => {
  it('finds this booking and rates the car and the driver', () => {
    const pending = customerBookingPendingRating(eligible({ bookingsAsCustomer: [bookingRow('b-1')] }), 'b-1');
    expect(pending?.context).toBe('BOOKING_REQUEST');
    expect(pending?.targets.map((t) => t.subjectType)).toEqual(['VEHICLE', 'USER']);
  });

  it('ignores bookingsAsProvider and other bookings', () => {
    const data = eligible({ bookingsAsProvider: [bookingRow('b-1')], bookingsAsCustomer: [bookingRow('b-2')] });
    expect(customerBookingPendingRating(data, 'b-1')).toBeNull();
  });
});

describe('isLockRedirectPending', () => {
  it('only while a ride is locked on another screen', () => {
    expect(isLockRedirectPending(null, '/account/inquiry/b-1')).toBe(false);
    expect(isLockRedirectPending('/account/my-trips/t-1', '/account/my-trips/t-1')).toBe(false);
    expect(isLockRedirectPending('/account/trip-request/ti-1', '/account/inquiry/b-1')).toBe(true);
  });
});

describe('shouldAutoOpenRatingPrompt', () => {
  const ready: RatingPromptFacts = {
    rideOver: true,
    eligibleSettled: true,
    pendingCount: 1,
    alreadyShown: false,
    sheetOpen: false,
    otherSheetOpen: false,
    lockRedirecting: false,
  };

  it('opens once the ride is over and the settled list still has it unrated', () => {
    expect(shouldAutoOpenRatingPrompt(ready)).toBe(true);
  });

  it.each<[string, Partial<RatingPromptFacts>]>([
    ['the ride is not over on the server yet (e.g. End still queued)', { rideOver: false }],
    ['the eligible list is still loading or refetching', { eligibleSettled: false }],
    ['nothing is left to rate', { pendingCount: 0 }],
    ['it already opened once on this device', { alreadyShown: true }],
    ['it is not known yet whether it opened before', { alreadyShown: null }],
    ['the sheet is already open', { sheetOpen: true }],
    ['another sheet is open', { otherSheetOpen: true }],
    ['the active-ride lock is redirecting', { lockRedirecting: true }],
  ])('stays closed when %s', (_label, over) => {
    expect(shouldAutoOpenRatingPrompt({ ...ready, ...over })).toBe(false);
  });
});

describe('buildReviewPayloads', () => {
  const rider = (id: string): PendingRating => ({
    context: 'TRIP_INQUIRY',
    contextId: id,
    title: `Rate rider: ${id}`,
    targets: [{ subjectType: 'USER', subjectId: `user-${id}`, label: id }],
  });
  const seat: PendingRating = {
    context: 'TRIP_INQUIRY',
    contextId: 'ti-seat',
    title: 'Rate your trip',
    targets: [
      { subjectType: 'USER_VEHICLE', subjectId: 'uv-1', label: CAR_LABEL },
      { subjectType: 'USER', subjectId: 'driver-1', label: DRIVER_LABEL },
    ],
  };

  it('sends one body per rated rider and skips riders left unrated', () => {
    const payloads = buildReviewPayloads(
      [rider('a'), rider('b'), rider('c')],
      { a: { 'USER:user-a': 4 }, c: { 'USER:user-c': 2 } },
      { a: { 'USER:user-a': '  friendly ' } },
    );
    expect(payloads).toEqual([
      {
        context: 'TRIP_INQUIRY',
        contextId: 'a',
        entries: [{ subjectType: 'USER', subjectId: 'user-a', rating: 4, comment: 'friendly' }],
      },
      { context: 'TRIP_INQUIRY', contextId: 'c', entries: [{ subjectType: 'USER', subjectId: 'user-c', rating: 2 }] },
    ]);
  });

  it('keeps a two-question ride all-or-nothing', () => {
    expect(buildReviewPayloads([seat], { 'ti-seat': { 'USER_VEHICLE:uv-1': 5 } }, {})).toEqual([]);
    expect(
      buildReviewPayloads([seat], { 'ti-seat': { 'USER_VEHICLE:uv-1': 5, 'USER:driver-1': 4 } }, {})[0].entries,
    ).toHaveLength(2);
  });

  it('is empty when nothing is rated', () => {
    expect(buildReviewPayloads([rider('a')], {}, {})).toEqual([]);
  });
});
