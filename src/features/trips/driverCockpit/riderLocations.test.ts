import { describe, expect, it } from '@jest/globals';

import { TripStatus } from '../../../types/enums';
import {
  RIDER_SHARE_LEAD_MIN,
  SHARE_GRACE_AFTER_START_H,
  hasRidersAwaitingPickup,
  riderLocationsPollWindow,
} from './riderLocations';

// Backend constants (live-location contract, 2026-10-29), hand-copied.
const BACKEND_RIDER_SHARE_LEAD_MIN = 30;
const BACKEND_SHARE_GRACE_AFTER_START_H = 3;

const DEPARTURE = '2026-10-29T10:00:00.000Z';
const DEP = Date.parse(DEPARTURE);
const MIN = 60_000;

const waiting = { pickupConfirmedAt: null, droppedOffAt: null };

describe('hasRidersAwaitingPickup', () => {
  it('true while any rider is neither picked up, dropped off nor a no-show', () => {
    expect(hasRidersAwaitingPickup([waiting])).toBe(true);
    expect(hasRidersAwaitingPickup([{ ...waiting, pickupConfirmedAt: DEPARTURE }, waiting])).toBe(true);
  });

  it('false once every rider is resolved, or with no riders', () => {
    expect(
      hasRidersAwaitingPickup([
        { ...waiting, pickupConfirmedAt: DEPARTURE },
        { ...waiting, droppedOffAt: DEPARTURE },
        { ...waiting, noShow: true },
        { ...waiting, noShowAt: DEPARTURE },
      ]),
    ).toBe(false);
    expect(hasRidersAwaitingPickup([])).toBe(false);
  });
});

describe('riderLocationsPollWindow', () => {
  const base = { tripStatus: TripStatus.ACTIVE, departureAt: DEPARTURE, ridersAwaitingPickup: true };

  it('mirrors the backend window constants', () => {
    expect(RIDER_SHARE_LEAD_MIN).toBe(BACKEND_RIDER_SHARE_LEAD_MIN);
    expect(SHARE_GRACE_AFTER_START_H).toBe(BACKEND_SHARE_GRACE_AFTER_START_H);
  });

  it('polls throughout an IN_PROGRESS trip while riders wait', () => {
    expect(
      riderLocationsPollWindow({ ...base, tripStatus: TripStatus.IN_PROGRESS, nowMs: DEP + 10 * 60 * MIN }),
    ).toEqual({ active: true, changesInMs: null });
  });

  it('an ACTIVE trip: not until 30 min before departure, and says when that is', () => {
    expect(riderLocationsPollWindow({ ...base, nowMs: DEP - 40 * MIN })).toEqual({
      active: false,
      changesInMs: 10 * MIN,
    });
  });

  it('an ACTIVE trip: from 30 min before to 3 h after departure', () => {
    expect(riderLocationsPollWindow({ ...base, nowMs: DEP - 30 * MIN }).active).toBe(true);
    expect(riderLocationsPollWindow({ ...base, nowMs: DEP + 3 * 60 * MIN }).active).toBe(true);
    expect(riderLocationsPollWindow({ ...base, nowMs: DEP + 3 * 60 * MIN + 1 })).toEqual({
      active: false,
      changesInMs: null,
    });
  });

  it('never without riders waiting, for other statuses, or without a departure', () => {
    expect(riderLocationsPollWindow({ ...base, ridersAwaitingPickup: false, nowMs: DEP }).active).toBe(false);
    expect(riderLocationsPollWindow({ ...base, tripStatus: TripStatus.COMPLETED, nowMs: DEP }).active).toBe(false);
    expect(riderLocationsPollWindow({ ...base, departureAt: undefined, nowMs: DEP }).active).toBe(false);
    expect(riderLocationsPollWindow({ ...base, departureAt: 'nope', nowMs: DEP }).active).toBe(false);
  });
});
