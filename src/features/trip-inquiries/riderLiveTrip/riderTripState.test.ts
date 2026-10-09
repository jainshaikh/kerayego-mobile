import { describe, expect, it } from '@jest/globals';

import { TripInquiryStatus, TripStatus } from '../../../types/enums';
import {
  confirmSheetCopy,
  deriveRiderRidePhase,
  formatAgo,
  isRideLocked,
  liveRideCopy,
  pendingRequestTripNote,
  rejectionReasonHeading,
  riderSeatActions,
  riderSeatStage,
  seatStageBadge,
  type RiderSeatFacts,
  type RiderSeatStage,
} from './riderTripState';

const AT = '2026-10-08T10:00:00.000Z';

function facts(overrides: Partial<RiderSeatFacts> = {}): RiderSeatFacts {
  return {
    inquiryStatus: TripInquiryStatus.ACCEPTED,
    tripStatus: TripStatus.IN_PROGRESS,
    droppedOffAt: null,
    noShowAt: null,
    ...overrides,
  };
}

const TRIP_STATUS_STAGE: Record<TripStatus, RiderSeatStage> = {
  [TripStatus.ACTIVE]: 'upcoming',
  [TripStatus.IN_PROGRESS]: 'live',
  [TripStatus.COMPLETED]: 'tripCompleted',
  [TripStatus.CANCELLED]: 'tripCancelled',
  [TripStatus.SUSPENDED]: 'tripSuspended',
  [TripStatus.PENDING_REVIEW]: 'tripUnavailable',
  [TripStatus.REJECTED]: 'tripUnavailable',
};

describe('riderSeatStage', () => {
  it.each(Object.values(TripInquiryStatus).filter((s) => s !== TripInquiryStatus.ACCEPTED))(
    'is a plain request for a %s inquiry, whatever the trip is doing',
    (inquiryStatus) => {
      for (const tripStatus of Object.values(TripStatus)) {
        expect(riderSeatStage(facts({ inquiryStatus, tripStatus }))).toBe('request');
      }
    },
  );

  it.each(Object.values(TripStatus))('maps an accepted seat on a %s trip to its stage', (tripStatus) => {
    expect(riderSeatStage(facts({ tripStatus }))).toBe(TRIP_STATUS_STAGE[tripStatus]);
  });

  it('ends the ride for the rider at their own drop-off, while the trip is still running', () => {
    expect(riderSeatStage(facts({ droppedOffAt: AT }))).toBe('droppedOff');
  });

  it('keeps a dropped-off rider dropped off after the trip completes', () => {
    expect(riderSeatStage(facts({ tripStatus: TripStatus.COMPLETED, droppedOffAt: AT }))).toBe('droppedOff');
  });

  it('shows a no-show mark while the trip runs and after it ends', () => {
    expect(riderSeatStage(facts({ noShowAt: AT }))).toBe('noShow');
    expect(riderSeatStage(facts({ tripStatus: TripStatus.COMPLETED, noShowAt: AT }))).toBe('noShow');
  });

  it('treats an absent noShowAt (older backend) like null', () => {
    expect(riderSeatStage(facts({ noShowAt: undefined }))).toBe('live');
  });
});

describe('isRideLocked', () => {
  it('locks only an accepted seat on an IN_PROGRESS trip', () => {
    for (const tripStatus of Object.values(TripStatus)) {
      for (const inquiryStatus of Object.values(TripInquiryStatus)) {
        expect([tripStatus, inquiryStatus, isRideLocked(facts({ tripStatus, inquiryStatus }))]).toEqual([
          tripStatus,
          inquiryStatus,
          tripStatus === TripStatus.IN_PROGRESS && inquiryStatus === TripInquiryStatus.ACCEPTED,
        ]);
      }
    }
  });

  it('releases as soon as the rider is dropped off or marked a no-show', () => {
    expect(isRideLocked(facts({ droppedOffAt: AT }))).toBe(false);
    expect(isRideLocked(facts({ noShowAt: AT }))).toBe(false);
  });

  it('locks again once a no-show is undone (the driver picks the rider up after all)', () => {
    expect(isRideLocked(facts({ noShowAt: null }))).toBe(true);
  });
});

describe('riderSeatActions', () => {
  it('offers nothing once the ride is over for the rider', () => {
    expect(riderSeatActions('droppedOff', TripInquiryStatus.ACCEPTED, TripStatus.IN_PROGRESS)).toEqual([]);
    expect(riderSeatActions('noShow', TripInquiryStatus.ACCEPTED, TripStatus.IN_PROGRESS)).toEqual([]);
  });

  it('keeps seat cancel while the trip is live or upcoming', () => {
    expect(riderSeatActions('live', TripInquiryStatus.ACCEPTED, TripStatus.IN_PROGRESS)).toEqual([
      TripInquiryStatus.CANCELLED,
    ]);
    expect(riderSeatActions('upcoming', TripInquiryStatus.ACCEPTED, TripStatus.ACTIVE)).toEqual([
      TripInquiryStatus.CANCELLED,
    ]);
  });

  it('defers to the trip-status rule once the trip is over', () => {
    expect(riderSeatActions('tripCompleted', TripInquiryStatus.ACCEPTED, TripStatus.COMPLETED)).toEqual([]);
    expect(riderSeatActions('tripSuspended', TripInquiryStatus.ACCEPTED, TripStatus.SUSPENDED)).toEqual([]);
  });

  it('lets a pending request be withdrawn', () => {
    expect(riderSeatActions('request', TripInquiryStatus.PENDING, TripStatus.ACTIVE)).toEqual([TripInquiryStatus.CANCELLED]);
  });
});

describe('deriveRiderRidePhase', () => {
  it("is on board once the driver's pickup is on the server, whatever the rider tapped", () => {
    expect(deriveRiderRidePhase({ pickupConfirmedAt: AT, riderConfirmedAtPickup: false })).toBe('onBoard');
    expect(deriveRiderRidePhase({ pickupConfirmedAt: AT, riderConfirmedAtPickup: true })).toBe('onBoard');
  });

  it("splits the pre-pickup phase on the rider's own arrival", () => {
    expect(deriveRiderRidePhase({ pickupConfirmedAt: null, riderConfirmedAtPickup: false })).toBe('headToPickup');
    expect(deriveRiderRidePhase({ pickupConfirmedAt: null, riderConfirmedAtPickup: true })).toBe('waitingAtPickup');
  });
});

describe('liveRideCopy', () => {
  const base = { driverAtPickup: false, etaMinutes: null, dropoffQueued: false };

  it('heads the rider to the pickup with no ETA yet', () => {
    const copy = liveRideCopy({ ...base, phase: 'headToPickup' });
    expect(copy.badge).toEqual({ label: 'Head To Pickup', tone: 'warning' });
    expect(copy.progressTitle).toBe('Head to your pickup point');
  });

  it('counts down to the pickup while waiting, then says the driver is arriving under a minute', () => {
    expect(liveRideCopy({ ...base, phase: 'waitingAtPickup', etaMinutes: 6.4 }).progressTitle).toBe('Pickup in ~6 min');
    expect(liveRideCopy({ ...base, phase: 'waitingAtPickup', etaMinutes: 0.4 }).progressTitle).toBe('Driver arriving now');
    expect(liveRideCopy({ ...base, phase: 'waitingAtPickup' }).progressTitle).toBe('Waiting for driver');
  });

  it("switches to the driver's arrival once it's on the server — an ETA to the stop no longer applies", () => {
    const copy = liveRideCopy({ ...base, phase: 'headToPickup', driverAtPickup: true, etaMinutes: 4 });
    expect(copy.badge.label).toBe('Driver Arrived');
    expect(copy.progressTitle).toBe('Your driver is at the pickup point');
  });

  it('targets the drop-off on board, with the ETA when known', () => {
    const copy = liveRideCopy({ ...base, phase: 'onBoard', etaMinutes: 22 });
    expect(copy.badge).toEqual({ label: 'On Board', tone: 'info' });
    expect(copy.progressTitle).toBe('Drop-off in ~22 min');
    expect(liveRideCopy({ ...base, phase: 'onBoard' }).progressTitle).toBe('On the way to your drop-off');
  });

  it('ignores a stale driver arrival once on board', () => {
    expect(liveRideCopy({ ...base, phase: 'onBoard', driverAtPickup: true }).badge.label).toBe('On Board');
  });

  it('says a queued drop-off is waiting to sync', () => {
    expect(liveRideCopy({ ...base, phase: 'onBoard', dropoffQueued: true, etaMinutes: 3 }).progressTitle).toBe(
      'Drop-off saved — waiting to sync',
    );
  });
});

describe('seatStageBadge', () => {
  it('names every non-request stage itself', () => {
    expect(seatStageBadge('upcoming', TripInquiryStatus.ACCEPTED).label).toBe('Seat confirmed');
    expect(seatStageBadge('droppedOff', TripInquiryStatus.ACCEPTED).label).toBe('Completed');
    expect(seatStageBadge('noShow', TripInquiryStatus.ACCEPTED)).toEqual({ label: 'No-show', tone: 'danger' });
    expect(seatStageBadge('tripSuspended', TripInquiryStatus.ACCEPTED).label).toBe('Trip suspended');
    expect(seatStageBadge('tripCancelled', TripInquiryStatus.ACCEPTED).label).toBe('Trip cancelled');
  });

  it("uses the request's own status label for a request", () => {
    expect(seatStageBadge('request', TripInquiryStatus.EXPIRED).label).toBe('Expired');
  });
});

describe('rejectionReasonHeading', () => {
  it('heads the reason for every status that carries one', () => {
    expect(rejectionReasonHeading(TripInquiryStatus.REJECTED)).toBe('Note from the driver');
    expect(rejectionReasonHeading(TripInquiryStatus.CANCELLED)).toBe('Why it was cancelled');
    expect(rejectionReasonHeading(TripInquiryStatus.EXPIRED)).toBe('Why it expired');
  });

  it('shows none for an open request', () => {
    expect(rejectionReasonHeading(TripInquiryStatus.PENDING)).toBeNull();
    expect(rejectionReasonHeading(TripInquiryStatus.ACCEPTED)).toBeNull();
  });
});

describe('pendingRequestTripNote', () => {
  it('explains a pending request on a trip that stopped taking riders', () => {
    expect(pendingRequestTripNote(TripInquiryStatus.PENDING, TripStatus.SUSPENDED)).toContain('suspended');
    expect(pendingRequestTripNote(TripInquiryStatus.PENDING, TripStatus.IN_PROGRESS)).toContain('already started');
    expect(pendingRequestTripNote(TripInquiryStatus.PENDING, TripStatus.COMPLETED)).toContain('already ended');
  });

  it('says nothing while the trip is ACTIVE, or for a request that is not pending', () => {
    expect(pendingRequestTripNote(TripInquiryStatus.PENDING, TripStatus.ACTIVE)).toBeNull();
    expect(pendingRequestTripNote(TripInquiryStatus.REJECTED, TripStatus.SUSPENDED)).toBeNull();
  });
});

describe('confirmSheetCopy', () => {
  const context = {
    inquiryStatus: TripInquiryStatus.ACCEPTED,
    tripStatus: TripStatus.ACTIVE,
    driverName: 'Ali',
    dropoffLabel: 'Saddar',
  };

  it('asks before a drop-off, naming the stop', () => {
    const copy = confirmSheetCopy('dropoff', context);
    expect(copy.title).toBe('Complete your ride?');
    expect(copy.body).toContain('Saddar');
    expect(copy.confirmLabel).toBe("Yes, I've arrived");
  });

  it('warns that the trip has already started when cancelling a seat mid-trip', () => {
    const copy = confirmSheetCopy('cancel', { ...context, tripStatus: TripStatus.IN_PROGRESS });
    expect(copy.title).toBe('Cancel your seat?');
    expect(copy.body).toContain('already started');
  });

  it('frames a pending request as a request', () => {
    const copy = confirmSheetCopy('cancel', { ...context, inquiryStatus: TripInquiryStatus.PENDING });
    expect(copy.title).toBe('Cancel this request?');
    expect(copy.confirmLabel).toBe('Cancel request');
  });
});

describe('formatAgo', () => {
  it('rounds down to whole minutes', () => {
    expect(formatAgo(0)).toBe('just now');
    expect(formatAgo(59_999)).toBe('just now');
    expect(formatAgo(60_000)).toBe('1 min ago');
    expect(formatAgo(12 * 60_000 + 59_000)).toBe('12 min ago');
  });

  it('switches to hours past an hour', () => {
    expect(formatAgo(60 * 60_000)).toBe('1 h ago');
    expect(formatAgo(65 * 60_000)).toBe('1 h 5 min ago');
  });

  it('never reads negative', () => {
    expect(formatAgo(-5_000)).toBe('just now');
  });
});
