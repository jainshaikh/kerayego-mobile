import { describe, expect, it } from '@jest/globals';

import type { EligibleBooking, EligibleTrip } from '../../api/reviews.api';
import {
  bookingDriverName,
  buildReviewPayload,
  CAR_LABEL,
  customerBookingRating,
  DRIVER_LABEL,
  driverTripRating,
  providerBookingRating,
  riderTripRating,
  targetKey,
} from './rateTargets';

const booking = (over: Partial<EligibleBooking> = {}): EligibleBooking => ({
  id: 'b-1',
  providerProfileId: 'pp-1',
  vehicle: { id: 'v-1', title: '2023 Toyota Camry', slug: 'camry' },
  assignedDriverId: 'drv-1',
  assignedDriver: { id: 'drv-1', name: 'ali', driverProfile: { fullName: 'Ali Khan' } },
  ...over,
});

const riderTrip = (over: Partial<EligibleTrip['trip']> = {}): EligibleTrip => ({
  id: 'ti-1',
  trip: {
    id: 't-1',
    originCity: 'lahore',
    destinationCity: 'islamabad',
    userVehicleId: 'uv-1',
    fleetVehicleId: null,
    isReturnTrip: false,
    postedByUserId: 'poster-1',
    ...over,
  },
});

describe('customerBookingRating', () => {
  it('rates the car and the assigned driver — never the business (A18)', () => {
    const rating = customerBookingRating(booking());
    expect(rating).toEqual({
      context: 'BOOKING_REQUEST',
      contextId: 'b-1',
      title: 'Rate: 2023 Toyota Camry',
      targets: [
        { subjectType: 'VEHICLE', subjectId: 'v-1', label: CAR_LABEL },
        { subjectType: 'USER', subjectId: 'drv-1', label: DRIVER_LABEL },
      ],
    });
    expect(rating!.targets.some((t) => t.subjectType === 'PROVIDER')).toBe(false);
  });

  it('rates only the car when the booking had no assigned driver', () => {
    const rating = customerBookingRating(booking({ assignedDriverId: null, assignedDriver: null }));
    expect(rating!.targets).toEqual([{ subjectType: 'VEHICLE', subjectId: 'v-1', label: CAR_LABEL }]);
  });

  it('is null when there is nothing the backend would accept', () => {
    expect(customerBookingRating(booking({ vehicle: undefined, assignedDriverId: null, assignedDriver: null }))).toBeNull();
  });
});

describe('bookingDriverName', () => {
  it("prefers the driver's verified profile name", () => {
    expect(bookingDriverName(booking())).toBe('Ali Khan');
    expect(bookingDriverName(booking({ assignedDriver: { id: 'drv-1', name: 'ali', driverProfile: null } }))).toBe('ali');
    expect(bookingDriverName(booking({ assignedDriver: null }))).toBeNull();
  });
});

describe('riderTripRating', () => {
  it("rates the driver's own car (USER_VEHICLE) and the driver on a normal trip", () => {
    expect(riderTripRating(riderTrip())!.targets).toEqual([
      { subjectType: 'USER_VEHICLE', subjectId: 'uv-1', label: CAR_LABEL },
      { subjectType: 'USER', subjectId: 'poster-1', label: DRIVER_LABEL },
    ]);
  });

  it("rates the business's fleet car (VEHICLE) on a return trip", () => {
    const rating = riderTripRating(riderTrip({ isReturnTrip: true, userVehicleId: null, fleetVehicleId: 'v-9' }));
    expect(rating!.targets).toEqual([
      { subjectType: 'VEHICLE', subjectId: 'v-9', label: CAR_LABEL },
      { subjectType: 'USER', subjectId: 'poster-1', label: DRIVER_LABEL },
    ]);
  });

  it('leaves the car out when the backend sent no vehicle id', () => {
    const rating = riderTripRating(riderTrip({ isReturnTrip: true, userVehicleId: null, fleetVehicleId: null }));
    expect(rating!.targets).toEqual([{ subjectType: 'USER', subjectId: 'poster-1', label: DRIVER_LABEL }]);
  });
});

describe('driver/provider ratings stay one private entry', () => {
  it('a driver rates only the rider', () => {
    const rating = driverTripRating({ id: 'ti-2', trip: { id: 't', originCity: 'a', destinationCity: 'b' }, user: { id: 'r-1', name: 'Sara' } });
    expect(rating!.targets).toEqual([{ subjectType: 'USER', subjectId: 'r-1', label: 'The rider' }]);
    expect(driverTripRating({ id: 'ti-3', trip: { id: 't', originCity: 'a', destinationCity: 'b' } })).toBeNull();
  });

  it('a business rates only the customer', () => {
    expect(providerBookingRating({ id: 'b-2', user: { id: 'c-1', name: 'Omar' } })!.targets).toEqual([
      { subjectType: 'USER', subjectId: 'c-1', label: 'The customer' },
    ]);
  });
});

describe('buildReviewPayload', () => {
  const pending = customerBookingRating(booking())!;
  const [car, driver] = pending.targets;

  it('is null until every question has a 1–5 rating, so no partial batch is sent', () => {
    expect(buildReviewPayload(pending, {}, {})).toBeNull();
    expect(buildReviewPayload(pending, { [targetKey(car)]: 4 }, {})).toBeNull();
    expect(buildReviewPayload(pending, { [targetKey(car)]: 4, [targetKey(driver)]: 0 }, {})).toBeNull();
    expect(buildReviewPayload(pending, { [targetKey(car)]: 4, [targetKey(driver)]: 6 }, {})).toBeNull();
    expect(buildReviewPayload(pending, { [targetKey(car)]: 4, [targetKey(driver)]: 2.5 }, {})).toBeNull();
  });

  it('sends one entry per question with trimmed, non-empty comments only', () => {
    expect(
      buildReviewPayload(
        pending,
        { [targetKey(car)]: 5, [targetKey(driver)]: 3 },
        { [targetKey(car)]: '  Clean car  ', [targetKey(driver)]: '   ' },
      ),
    ).toEqual({
      context: 'BOOKING_REQUEST',
      contextId: 'b-1',
      entries: [
        { subjectType: 'VEHICLE', subjectId: 'v-1', rating: 5, comment: 'Clean car' },
        { subjectType: 'USER', subjectId: 'drv-1', rating: 3 },
      ],
    });
  });

  it('caps comments at the backend limit', () => {
    const payload = buildReviewPayload(
      pending,
      { [targetKey(car)]: 5, [targetKey(driver)]: 5 },
      { [targetKey(car)]: 'x'.repeat(1200) },
    );
    expect(payload!.entries[0].comment).toHaveLength(1000);
  });
});
