import { describe, expect, it } from '@jest/globals';

import {
  NO_SHOW_MIN_WAIT_MINUTES,
  NO_SHOW_MIN_WAIT_MS,
  estimateServerNowMs,
  formatCountdown,
  formatElapsed,
  noShowGate,
  noShowRemainingMs,
  serverClockFrom,
  waitedAtStopMs,
  type NoShowContext,
  type NoShowRider,
  type ServerClock,
} from './noShow';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// Server time of the driver's Reached at the pickup stop.
const ARRIVED_MS = Date.UTC(2026, 9, 8, 9, 0, 0);
const ARRIVED_AT = new Date(ARRIVED_MS).toISOString();

// The manifest was built 2 min after that arrival and reached a phone whose
// own clock runs 7 min slow — waiting time must not care.
const DEVICE_SKEW_MS = -7 * MINUTE;
const deviceTime = (serverMs: number) => serverMs + DEVICE_SKEW_MS;
const CLOCK: ServerClock = { serverNowMs: ARRIVED_MS + 2 * MINUTE, receivedAtMs: deviceTime(ARRIVED_MS + 2 * MINUTE) };

function rider(overrides: Partial<NoShowRider> = {}): NoShowRider {
  return { pickupConfirmedAt: null, droppedOffAt: null, noShow: false, pickupStop: { id: 'stop-p1' }, ...overrides };
}

function context(overrides: Partial<NoShowContext> = {}): NoShowContext {
  return {
    routeStops: [
      { id: 'stop-p1', arrivedAt: ARRIVED_AT },
      { id: 'stop-p2', arrivedAt: null },
      { id: 'stop-d1', arrivedAt: null },
    ],
    serverClock: CLOCK,
    queuedArrivalStopIds: new Set(),
    ...overrides,
  };
}

describe('NO_SHOW_MIN_WAIT', () => {
  it('mirrors the backend constant NO_SHOW_MIN_WAIT_MINUTES = 5', () => {
    expect(NO_SHOW_MIN_WAIT_MINUTES).toBe(5);
    expect(NO_SHOW_MIN_WAIT_MS).toBe(5 * MINUTE);
  });
});

describe('serverClockFrom', () => {
  it('anchors the server time to the device time the response arrived', () => {
    expect(serverClockFrom('2026-10-08T09:02:00.000Z', 1_000)).toEqual({
      serverNowMs: Date.UTC(2026, 9, 8, 9, 2, 0),
      receivedAtMs: 1_000,
    });
  });

  it('is null without a usable serverNow — an older backend', () => {
    expect(serverClockFrom(undefined, 1_000)).toBeNull();
    expect(serverClockFrom(null, 1_000)).toBeNull();
    expect(serverClockFrom('', 1_000)).toBeNull();
    expect(serverClockFrom('not a date', 1_000)).toBeNull();
  });

  it('is null before the manifest has been received (dataUpdatedAt 0)', () => {
    expect(serverClockFrom('2026-10-08T09:02:00.000Z', 0)).toBeNull();
  });
});

describe('estimateServerNowMs', () => {
  it('carries the server time forward by the device time elapsed since the fetch', () => {
    expect(estimateServerNowMs(CLOCK, CLOCK.receivedAtMs)).toBe(CLOCK.serverNowMs);
    expect(estimateServerNowMs(CLOCK, CLOCK.receivedAtMs + 95 * SECOND)).toBe(CLOCK.serverNowMs + 95 * SECOND);
  });

  it('never winds back when the device clock is set backwards after the fetch', () => {
    expect(estimateServerNowMs(CLOCK, CLOCK.receivedAtMs - 10 * MINUTE)).toBe(CLOCK.serverNowMs);
  });
});

describe('waitedAtStopMs', () => {
  it('is serverNow - arrivedAt at the moment of the fetch, whatever the device clock says', () => {
    expect(waitedAtStopMs(ARRIVED_AT, CLOCK, CLOCK.receivedAtMs)).toBe(2 * MINUTE);
    const fastPhone: ServerClock = { ...CLOCK, receivedAtMs: CLOCK.serverNowMs + 3 * MINUTE };
    expect(waitedAtStopMs(ARRIVED_AT, fastPhone, fastPhone.receivedAtMs)).toBe(2 * MINUTE);
  });

  it('keeps counting on device time between fetches', () => {
    expect(waitedAtStopMs(ARRIVED_AT, CLOCK, CLOCK.receivedAtMs + 67 * SECOND)).toBe(3 * MINUTE + 7 * SECOND);
  });

  it('is null without a server arrival, without a clock, or with an unreadable arrival', () => {
    expect(waitedAtStopMs(null, CLOCK, CLOCK.receivedAtMs)).toBeNull();
    expect(waitedAtStopMs(undefined, CLOCK, CLOCK.receivedAtMs)).toBeNull();
    expect(waitedAtStopMs(ARRIVED_AT, null, CLOCK.receivedAtMs)).toBeNull();
    expect(waitedAtStopMs('garbage', CLOCK, CLOCK.receivedAtMs)).toBeNull();
  });

  it('is never negative', () => {
    const later = new Date(CLOCK.serverNowMs + MINUTE).toISOString();
    expect(waitedAtStopMs(later, CLOCK, CLOCK.receivedAtMs)).toBe(0);
  });
});

describe('noShowGate', () => {
  it("is timed from the server arrival at the rider's own pickup stop", () => {
    expect(noShowGate(rider(), context())).toEqual({ state: 'timed', arrivedAtMs: ARRIVED_MS, clock: CLOCK });
  });

  it('stays hidden on an older backend (no serverNow), even with an arrival', () => {
    expect(noShowGate(rider(), context({ serverClock: null }))).toEqual({ state: 'hidden' });
  });

  it('stays hidden for a rider already picked up, dropped off or marked as a no-show', () => {
    expect(noShowGate(rider({ pickupConfirmedAt: ARRIVED_AT }), context()).state).toBe('hidden');
    expect(noShowGate(rider({ droppedOffAt: ARRIVED_AT }), context()).state).toBe('hidden');
    expect(noShowGate(rider({ noShow: true }), context()).state).toBe('hidden');
  });

  it('stays hidden for a rider with no pickup stop — the server refuses those', () => {
    expect(noShowGate(rider({ pickupStop: null }), context()).state).toBe('hidden');
  });

  it("stays hidden until the rider's pickup stop has an arrival — another stop's doesn't count", () => {
    expect(noShowGate(rider({ pickupStop: { id: 'stop-p2' } }), context()).state).toBe('hidden');
    // An older manifest shape with no arrivedAt key at all.
    expect(noShowGate(rider(), context({ routeStops: [{ id: 'stop-p1' }] })).state).toBe('hidden');
    // A pickup stop missing from routeStops.
    expect(noShowGate(rider({ pickupStop: { id: 'stop-gone' } }), context()).state).toBe('hidden');
  });

  it('waits for a Reached still queued offline to sync', () => {
    const queued = context({ queuedArrivalStopIds: new Set(['stop-p2']) });
    expect(noShowGate(rider({ pickupStop: { id: 'stop-p2' } }), queued)).toEqual({ state: 'arrivalUnsynced' });
  });

  it("goes by the server's arrival when it has one, even if a repeat Reached is queued", () => {
    const queued = context({ queuedArrivalStopIds: new Set(['stop-p1']) });
    expect(noShowGate(rider(), queued).state).toBe('timed');
  });
});

describe('noShowRemainingMs', () => {
  const remainingAt = (serverMs: number, clock: ServerClock = CLOCK) =>
    noShowRemainingMs(ARRIVED_MS, clock, clock.receivedAtMs + (serverMs - clock.serverNowMs));

  it('counts down the 5 minutes from the server arrival', () => {
    expect(remainingAt(ARRIVED_MS + 2 * MINUTE)).toBe(3 * MINUTE);
    expect(remainingAt(ARRIVED_MS + 4 * MINUTE + 48 * SECOND)).toBe(12 * SECOND);
  });

  it('reaches 0 at exactly 5 minutes (the backend allows elapsed >= 5 min) and stays there', () => {
    expect(remainingAt(ARRIVED_MS + 5 * MINUTE - 1)).toBe(1);
    expect(remainingAt(ARRIVED_MS + 5 * MINUTE)).toBe(0);
    expect(remainingAt(ARRIVED_MS + 40 * MINUTE)).toBe(0);
  });

  it("doesn't depend on the device clock's offset from the server", () => {
    const fastPhone: ServerClock = { ...CLOCK, receivedAtMs: CLOCK.serverNowMs + 11 * MINUTE };
    expect(remainingAt(ARRIVED_MS + 3 * MINUTE, fastPhone)).toBe(remainingAt(ARRIVED_MS + 3 * MINUTE));
  });

  it("re-anchors on a refetch's fresh serverNow", () => {
    const refetched: ServerClock = { serverNowMs: ARRIVED_MS + 4 * MINUTE, receivedAtMs: deviceTime(ARRIVED_MS + 4 * MINUTE) };
    expect(noShowRemainingMs(ARRIVED_MS, refetched, refetched.receivedAtMs)).toBe(MINUTE);
  });

  it('reads as the countdown label the rider card shows', () => {
    expect(`No-show in ${formatCountdown(remainingAt(ARRIVED_MS + 2 * MINUTE + 48 * SECOND))}`).toBe('No-show in 2:12');
    expect(formatCountdown(remainingAt(ARRIVED_MS + 5 * MINUTE - 1))).toBe('0:01');
  });
});

describe('formatElapsed', () => {
  it('shows whole seconds elapsed as m:ss, or h:mm:ss from an hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59_999)).toBe('0:59');
    expect(formatElapsed(61_000)).toBe('1:01');
    expect(formatElapsed(12 * MINUTE + 5 * SECOND)).toBe('12:05');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
  });

  it('never shows a negative time', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});

describe('formatCountdown', () => {
  it('rounds up so it never reads 0:00 while time is left', () => {
    expect(formatCountdown(5 * MINUTE)).toBe('5:00');
    expect(formatCountdown(191_500)).toBe('3:12');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-1)).toBe('0:00');
  });

  it('switches to h:mm:ss from an hour', () => {
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
  });
});
