import { describe, expect, it } from '@jest/globals';

import type { NormalizedApiError } from '../../api/errors';
import type { BookingEstimate, RentalPackageFit } from '../../types/api.types';
import { BookingTripType, RentalDurationType } from '../../types/enums';
import {
  choosePackageLabel,
  createPayloadOf,
  endStopIndexes,
  estimateInputOf,
  estimatePanelOf,
  rentalRequestFailure,
  stopsPayload,
  stopsReady,
  suggestionOf,
  withCities,
  type RentalRequestDraft,
} from './rentalRequest';

const NOW = Date.parse('2026-11-12T08:00:00.000Z');
const TOMORROW = new Date('2026-11-13T04:00:00.000Z');

const hyderabad = { label: 'Qasimabad, Hyderabad', lat: 25.39, lng: 68.35 };
const hala = { label: 'Hala Naka', lat: 25.42, lng: 68.37 };
const larkana = { label: 'Larkana Bypass', lat: 27.55, lng: 68.21 };

function draft(over: Partial<RentalRequestDraft> = {}): RentalRequestDraft {
  return {
    requestedFromDate: TOMORROW,
    durationType: RentalDurationType.HOURS_12,
    durationQuantity: 1,
    tripType: BookingTripType.ONE_WAY,
    pickupStops: [hyderabad],
    dropoffStops: [larkana],
    passengerCount: 3,
    driverHoursPerDay: 10,
    daysPerWeek: 6,
    kmPerMonth: null,
    message: '',
    ...over,
  };
}

describe('stops', () => {
  it('sends every pickup, then every drop-off, with trimmed labels and coordinates', () => {
    expect(stopsPayload([hyderabad, { ...hala, label: ' Hala Naka ' }], [larkana])).toEqual([
      { type: 'PICKUP', label: 'Qasimabad, Hyderabad', lat: 25.39, lng: 68.35 },
      { type: 'PICKUP', label: 'Hala Naka', lat: 25.42, lng: 68.37 },
      { type: 'DROPOFF', label: 'Larkana Bypass', lat: 27.55, lng: 68.21 },
    ]);
  });

  it('is ready only with a pickup and a drop-off, every place picked, at most 10 in all', () => {
    expect(stopsReady(draft())).toBe(true);
    expect(stopsReady(draft({ dropoffStops: [] }))).toBe(false);
    // Typed but not picked: no coordinates.
    expect(stopsReady(draft({ dropoffStops: [{ label: 'Larkana' }] }))).toBe(false);
    expect(stopsReady(draft({ pickupStops: Array(5).fill(hyderabad), dropoffStops: Array(6).fill(larkana) }))).toBe(false);
  });

  it('looks up a city only for the first pickup and the last drop-off', () => {
    const stops = stopsPayload([hyderabad, hala], [hala, larkana]);
    expect(endStopIndexes(stops)).toEqual([0, 3]);
    expect(withCities(stops, new Map([[0, 'Hyderabad'], [3, ' Larkana ']]))).toEqual([
      { ...stops[0], city: 'Hyderabad' },
      stops[1],
      stops[2],
      { ...stops[3], city: 'Larkana' },
    ]);
    // A failed lookup just leaves the city out.
    expect(withCities(stops, new Map([[0, null]]))[0]).not.toHaveProperty('city');
  });
});

describe('estimateInputOf', () => {
  it('asks for a priced package once everything is set — without a count for hour packages', () => {
    expect(estimateInputOf(draft(), 'car-1', NOW)).toEqual({
      vehicleId: 'car-1',
      requestedFromDate: TOMORROW.toISOString(),
      tripType: BookingTripType.ONE_WAY,
      stops: stopsPayload([hyderabad], [larkana]),
      durationType: RentalDurationType.HOURS_12,
    });
    expect(estimateInputOf(draft({ durationType: RentalDurationType.DAY, durationQuantity: 2 }), 'car-1', NOW)).toMatchObject({
      durationType: RentalDurationType.DAY,
      durationQuantity: 2,
    });
  });

  it('waits for the trip type, a future pickup time, a valid count and every place', () => {
    expect(estimateInputOf(draft({ tripType: null }), 'car-1', NOW)).toBeNull();
    expect(estimateInputOf(draft({ requestedFromDate: undefined }), 'car-1', NOW)).toBeNull();
    expect(estimateInputOf(draft({ requestedFromDate: new Date(NOW - 60_000) }), 'car-1', NOW)).toBeNull();
    expect(estimateInputOf(draft({ durationType: RentalDurationType.DAY, durationQuantity: 7 }), 'car-1', NOW)).toBeNull();
    expect(estimateInputOf(draft({ pickupStops: [{ label: 'Hyderabad' }] }), 'car-1', NOW)).toBeNull();
  });

  it('never asks for week or month — they aren’t routed (A79)', () => {
    expect(estimateInputOf(draft({ durationType: RentalDurationType.WEEK }), 'car-1', NOW)).toBeNull();
  });
});

describe('createPayloadOf', () => {
  const stops = stopsPayload([hyderabad], [larkana]);

  it('sends a priced request with its trip type and passengers, no count for an hour package', () => {
    expect(createPayloadOf({ ...draft(), requestedFromDate: TOMORROW, message: '  gate 2  ' }, 'car-1', stops)).toEqual({
      vehicleId: 'car-1',
      requestedFromDate: TOMORROW.toISOString(),
      durationType: RentalDurationType.HOURS_12,
      stops,
      passengerCount: 3,
      message: 'gate 2',
      tripType: BookingTripType.ONE_WAY,
    });
  });

  it('sends a week/month request without a trip type, with the driver’s hours and days (A85)', () => {
    const payload = createPayloadOf(
      { ...draft({ durationType: RentalDurationType.MONTH, durationQuantity: 2, kmPerMonth: 2500 }), requestedFromDate: TOMORROW },
      'car-1',
      stops,
    );
    expect(payload).toEqual({
      vehicleId: 'car-1',
      requestedFromDate: TOMORROW.toISOString(),
      durationType: RentalDurationType.MONTH,
      durationQuantity: 2,
      stops,
      passengerCount: 3,
      driverHoursPerDay: 10,
      daysPerWeek: 6,
      kmPerMonth: 2500,
    });
    expect(payload).not.toHaveProperty('tripType');
  });

  it('leaves kilometres per month out when not given, and never sends the old place fields', () => {
    const payload = createPayloadOf(
      { ...draft({ durationType: RentalDurationType.WEEK }), requestedFromDate: TOMORROW },
      'car-1',
      stops,
    );
    expect(payload).not.toHaveProperty('kmPerMonth');
    for (const old of ['pickupLocation', 'pickupCity', 'isOneWay', 'dropoffCity', 'dropoffLocation']) {
      expect(payload).not.toHaveProperty(old);
    }
  });
});

function apiError(over: Partial<NormalizedApiError>): NormalizedApiError {
  return { kind: 'validation', message: 'x', statusCode: 400, ...over };
}

describe('rentalRequestFailure', () => {
  it('offers the suggested package on ROUTE_DOES_NOT_FIT', () => {
    const failure = rentalRequestFailure(
      apiError({
        code: 'ROUTE_DOES_NOT_FIT',
        message: 'This trip needs about 7 h 10 m (330 km). Choose 12 hours.',
        details: { suggestion: { durationType: 'HOURS_12', durationQuantity: 1 }, distanceKm: 330 },
      }),
    );
    expect(failure).toEqual({
      message: 'This trip needs about 7 h 10 m (330 km). Choose 12 hours.',
      duplicate: false,
      suggestion: { durationType: RentalDurationType.HOURS_12, durationQuantity: 1 },
      field: null,
    });
    expect(choosePackageLabel(failure.suggestion!)).toBe('Choose 12 hours');
  });

  it('has no suggestion when nothing fits, or the details are missing or odd', () => {
    expect(suggestionOf({ suggestion: null })).toBeNull();
    expect(suggestionOf(undefined)).toBeNull();
    expect(suggestionOf({ suggestion: { durationType: 'WEEK', durationQuantity: 1 } })).toBeNull();
  });

  it('puts START_TIME_PAST under the date field', () => {
    expect(rentalRequestFailure(apiError({ code: 'START_TIME_PAST', message: 'Choose a pickup time in the future.' }))).toMatchObject({
      field: 'requestedFromDate',
      message: 'Choose a pickup time in the future.',
    });
  });

  it('keeps the duplicate 409 and the route-unavailable 503', () => {
    expect(rentalRequestFailure(apiError({ kind: 'conflict', statusCode: 409, message: '' })).duplicate).toBe(true);
    expect(rentalRequestFailure(apiError({ kind: 'server', statusCode: 503, code: 'ROUTE_UNAVAILABLE', message: '' })).message).toBe(
      "We couldn't check the route right now. Please try again in a moment.",
    );
  });
});

function fit(over: Partial<RentalPackageFit>): RentalPackageFit {
  return {
    durationType: RentalDurationType.HOURS_12,
    durationQuantity: 1,
    fits: true,
    spareMinutes: 290,
    endsAt: '2026-11-13T16:00:00.000Z',
    timeAtDestinationMinutes: null,
    ...over,
  };
}

function estimate(over: Partial<BookingEstimate> = {}): BookingEstimate {
  return {
    vehicleId: 'car-1',
    tripType: BookingTripType.ONE_WAY,
    requestedFromDate: TOMORROW.toISOString(),
    route: {
      distanceKm: 330,
      drivingMinutes: 320,
      timeNeededMinutes: 430,
      wayBack: null,
      stops: [
        { type: 'PICKUP', sortOrder: 0, label: 'Qasimabad', lat: 1, lng: 1, city: 'hyderabad', note: null, legDistanceKm: null, legDurationMinutes: null, expectedAt: null },
        { type: 'DROPOFF', sortOrder: 1, label: 'Bypass', lat: 2, lng: 2, city: 'larkana', note: null, legDistanceKm: 330, legDurationMinutes: 320, expectedAt: null },
      ],
    },
    packages: [],
    suggestion: { durationType: RentalDurationType.HOURS_12, durationQuantity: 1 },
    selected: fit({}),
    ...over,
  };
}

describe('estimatePanelOf', () => {
  it('says the route, the time it needs, and how much the package leaves', () => {
    const panel = estimatePanelOf(estimate(), BookingTripType.ONE_WAY);
    expect(panel.routeLine).toBe('330 km · 5 h 20 min driving');
    expect(panel.neededLine).toBe('About 7 h 10 min with stops and breaks');
    expect(panel.fit).toMatchObject({ fits: true, line: 'Fits 12 hours — about 4 h 50 min to spare' });
    expect(panel.destinationLine).toBeNull();
  });

  it('names the smallest package that fits when the picked one doesn’t (A77)', () => {
    const panel = estimatePanelOf(
      estimate({ selected: fit({ durationType: RentalDurationType.HOURS_6, fits: false, spareMinutes: -70 }) }),
      BookingTripType.ONE_WAY,
    );
    expect(panel.fit).toEqual({
      fits: false,
      message: 'This trip needs about 7 h 10 min (330 km). Choose 12 hours.',
      suggestion: { durationType: RentalDurationType.HOURS_12, durationQuantity: 1 },
    });
  });

  it('says when no package of this car fits', () => {
    const panel = estimatePanelOf(estimate({ suggestion: null, selected: fit({ fits: false }) }), BookingTripType.ONE_WAY);
    expect(panel.fit).toMatchObject({ fits: false, suggestion: null });
    expect(panel.fit && !panel.fit.fits && panel.fit.message).toBe(
      "This trip needs about 7 h 10 min (330 km). It's too long for this car's packages.",
    );
  });

  it('round trip: says there and back, and the time at the destination (A76)', () => {
    const panel = estimatePanelOf(
      estimate({ tripType: BookingTripType.ROUND_TRIP, selected: fit({ timeAtDestinationMinutes: 180, spareMinutes: 180 }) }),
      BookingTripType.ROUND_TRIP,
    );
    expect(panel.routeLine).toBe('330 km · 5 h 20 min driving, there and back');
    expect(panel.destinationLine).toBe('About 3 h at Larkana');
  });

  it('days: no "to spare" (their limit is 10 h of driving a day)', () => {
    const panel = estimatePanelOf(
      estimate({ selected: fit({ durationType: RentalDurationType.DAY, durationQuantity: 2, spareMinutes: 880 }) }),
      BookingTripType.ONE_WAY,
    );
    expect(panel.fit).toMatchObject({ fits: true, line: 'Fits 2 days' });
  });
});
