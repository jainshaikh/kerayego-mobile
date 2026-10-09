import { describe, expect, it } from '@jest/globals';

import { TripInquiryStatus, TripStatus } from '../../../types/enums';
import { computeRideActionAvailability } from './rideActionAvailability';

type Params = Parameters<typeof computeRideActionAvailability>[0];

// An accepted rider mid-trip, standing right at both stops with a live fix.
function params(overrides: Partial<Params> = {}): Params {
  return {
    inquiryStatus: TripInquiryStatus.ACCEPTED,
    tripStatus: TripStatus.IN_PROGRESS,
    pickupConfirmedAt: null,
    droppedOffAt: null,
    noShowAt: null,
    pickupStopLocated: true,
    dropoffStopLocated: true,
    pickupDistanceM: 0,
    dropoffDistanceM: 0,
    locationDenied: false,
    hasPosition: true,
    ...overrides,
  };
}

const ALL_TRIP_STATUSES = Object.values(TripStatus);
const ALL_INQUIRY_STATUSES = Object.values(TripInquiryStatus);

describe('computeRideActionAvailability — who may act at all', () => {
  it('offers both actions only on an ACCEPTED seat while the trip is IN_PROGRESS', () => {
    for (const tripStatus of ALL_TRIP_STATUSES) {
      for (const inquiryStatus of ALL_INQUIRY_STATUSES) {
        const result = computeRideActionAvailability(params({ tripStatus, inquiryStatus }));
        const riding = tripStatus === TripStatus.IN_PROGRESS && inquiryStatus === TripInquiryStatus.ACCEPTED;
        expect([tripStatus, inquiryStatus, result.showArriveButton]).toEqual([tripStatus, inquiryStatus, riding]);
        expect([tripStatus, inquiryStatus, result.showCompleteButton]).toEqual([tripStatus, inquiryStatus, riding]);
      }
    }
  });

  it('never offers the complete button once the trip is COMPLETED (the backend refuses events then)', () => {
    expect(computeRideActionAvailability(params({ tripStatus: TripStatus.COMPLETED })).showCompleteButton).toBe(false);
  });

  it('hides both actions for a rider marked as a no-show (the backend answers 409)', () => {
    const result = computeRideActionAvailability(params({ noShowAt: '2026-10-08T10:05:00.000Z' }));
    expect(result.showArriveButton).toBe(false);
    expect(result.showCompleteButton).toBe(false);
  });

  it('treats a missing noShowAt (older backend) as not a no-show', () => {
    const result = computeRideActionAvailability(params({ noShowAt: undefined }));
    expect(result.showArriveButton).toBe(true);
    expect(result.showCompleteButton).toBe(true);
  });
});

describe('computeRideActionAvailability — arrive (pickup)', () => {
  it('hides the arrive button once pickup is confirmed', () => {
    const result = computeRideActionAvailability(params({ pickupConfirmedAt: '2026-10-08T10:00:00.000Z' }));
    expect(result.showArriveButton).toBe(false);
  });

  it('hides the arrive button once the rider is dropped off', () => {
    const result = computeRideActionAvailability(params({ droppedOffAt: '2026-10-08T11:00:00.000Z' }));
    expect(result.showArriveButton).toBe(false);
  });

  it('hides the arrive button when the pickup stop has no coordinates (or there is none)', () => {
    expect(computeRideActionAvailability(params({ pickupStopLocated: false })).showArriveButton).toBe(false);
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
  it('hides the complete button once the rider is dropped off', () => {
    const result = computeRideActionAvailability(params({ droppedOffAt: '2026-10-08T11:00:00.000Z' }));
    expect(result.showCompleteButton).toBe(false);
  });

  it('still offers complete before the driver taps pickup (a rider may self-report drop-off)', () => {
    expect(computeRideActionAvailability(params({ pickupConfirmedAt: null })).showCompleteButton).toBe(true);
  });

  it('enables complete inside the 100 m radius, inclusive', () => {
    expect(computeRideActionAvailability(params({ dropoffDistanceM: 100 })).canComplete).toBe(true);
    expect(computeRideActionAvailability(params({ dropoffDistanceM: 100.01 })).canComplete).toBe(false);
    expect(computeRideActionAvailability(params({ dropoffDistanceM: null })).canComplete).toBe(false);
  });

  it('allows completing anywhere when the drop-off stop has nothing to geofence against', () => {
    const result = computeRideActionAvailability(params({ dropoffStopLocated: false, dropoffDistanceM: null }));
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
