import { describe, expect, it } from '@jest/globals';

import { TripStatus } from '../../../types/enums';
import { computeRideActionAvailability } from './rideActionAvailability';

type Params = Parameters<typeof computeRideActionAvailability>[0];

// An accepted rider mid-trip, standing right at both stops with a live fix.
function params(overrides: Partial<Params> = {}): Params {
  return {
    pickupConfirmedAt: null,
    droppedOffAt: null,
    tripStatus: TripStatus.IN_PROGRESS,
    hasPickupStop: true,
    hasDropoffStop: true,
    pickupDistanceM: 0,
    dropoffDistanceM: 0,
    locationDenied: false,
    hasPosition: true,
    ...overrides,
  };
}

const ALL_TRIP_STATUSES = Object.values(TripStatus);

describe('computeRideActionAvailability — arrive (pickup)', () => {
  it('shows the arrive button only while the trip is IN_PROGRESS', () => {
    for (const tripStatus of ALL_TRIP_STATUSES) {
      expect(computeRideActionAvailability(params({ tripStatus })).showArriveButton).toBe(
        tripStatus === TripStatus.IN_PROGRESS,
      );
    }
  });

  it('hides the arrive button once pickup is confirmed', () => {
    const result = computeRideActionAvailability(params({ pickupConfirmedAt: '2026-10-08T10:00:00.000Z' }));
    expect(result.showArriveButton).toBe(false);
  });

  it('hides the arrive button when the rider has no pickup stop', () => {
    expect(computeRideActionAvailability(params({ hasPickupStop: false })).showArriveButton).toBe(false);
  });

  it('enables arrive inside the 100 m radius, inclusive', () => {
    expect(computeRideActionAvailability(params({ pickupDistanceM: 100 })).canArrive).toBe(true);
    expect(computeRideActionAvailability(params({ pickupDistanceM: 100.01 })).canArrive).toBe(false);
  });

  it('keeps arrive disabled with no distance reading', () => {
    expect(computeRideActionAvailability(params({ pickupDistanceM: null })).canArrive).toBe(false);
  });
});

describe('computeRideActionAvailability — complete (drop-off)', () => {
  it('shows the complete button for IN_PROGRESS and COMPLETED trips only', () => {
    for (const tripStatus of ALL_TRIP_STATUSES) {
      expect(computeRideActionAvailability(params({ tripStatus })).showCompleteButton).toBe(
        tripStatus === TripStatus.IN_PROGRESS || tripStatus === TripStatus.COMPLETED,
      );
    }
  });

  it('hides the complete button once the rider is dropped off', () => {
    const result = computeRideActionAvailability(params({ droppedOffAt: '2026-10-08T11:00:00.000Z' }));
    expect(result.showCompleteButton).toBe(false);
  });

  it('enables complete inside the 100 m radius, inclusive', () => {
    expect(computeRideActionAvailability(params({ dropoffDistanceM: 100 })).canComplete).toBe(true);
    expect(computeRideActionAvailability(params({ dropoffDistanceM: 100.01 })).canComplete).toBe(false);
    expect(computeRideActionAvailability(params({ dropoffDistanceM: null })).canComplete).toBe(false);
  });

  it('allows completing anywhere when there is no drop-off stop to geofence', () => {
    const result = computeRideActionAvailability(params({ hasDropoffStop: false, dropoffDistanceM: null }));
    expect(result.canComplete).toBe(true);
  });
});

describe('computeRideActionAvailability — disabled reasons', () => {
  it('prefers the location-denied reason over everything else', () => {
    const result = computeRideActionAvailability(params({ locationDenied: true, hasPosition: false }));
    expect(result.arriveDisabledReason).toBe('Enable location access to confirm your arrival.');
    expect(result.completeDisabledReason).toBe('Enable location access to complete the ride.');
  });

  it('then waits for a position fix', () => {
    const result = computeRideActionAvailability(params({ hasPosition: false }));
    expect(result.arriveDisabledReason).toBe('Waiting for your location…');
    expect(result.completeDisabledReason).toBe('Waiting for your location…');
  });

  it('otherwise asks the rider to move closer', () => {
    const result = computeRideActionAvailability(params({ pickupDistanceM: 500, dropoffDistanceM: 500 }));
    expect(result.arriveDisabledReason).toBe('Move within 100m of your pickup point to confirm arrival.');
    expect(result.completeDisabledReason).toBe('Move within 100m of your drop-off point to complete the ride.');
  });
});
