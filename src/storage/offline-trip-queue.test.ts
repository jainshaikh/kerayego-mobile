import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { TripEventType } from '../types/enums';
import {
  OFFLINE_QUEUE_MAX_ATTEMPTS,
  OFFLINE_QUEUE_TTL_MS,
  createQueuedAction,
  dismissDroppedActions,
  dropQueuedAction,
  enqueueTripAction,
  getDroppedActions,
  getQueuedActionsForTrip,
  getQueuedActionsForUser,
  isExpired,
  pruneQueue,
  recordFailedAttempt,
  removeQueuedAction,
  retryDelayMs,
  shouldCountAttempt,
  subscribeQueueChanges,
  type QueuedTripAction,
} from './offline-trip-queue';

// AsyncStorage is the in-memory mock registered in jest.setup.ts. Its
// get/set each yield to the microtask queue, so unlocked read-modify-writes
// really do interleave here, as they do on a device.

const NOW = Date.parse('2026-10-08T09:00:00.000Z');
const QUEUED_AT = new Date(NOW).toISOString();
const HOUR = 60 * 60 * 1000;
const ALI = 'user-ali';
const SARA = 'user-sara';

function startAction(id: string, tripId: string, userId = ALI, createdAt = QUEUED_AT): QueuedTripAction {
  return createQueuedAction({ id, kind: 'start', tripId, createdAt }, userId);
}

function pickupAction(id: string, tripId: string, userId = ALI, createdAt = QUEUED_AT): QueuedTripAction {
  return createQueuedAction(
    {
      id,
      kind: 'event',
      tripId,
      createdAt,
      payload: { id, tripInquiryId: 'inq-1', type: TripEventType.PICKUP, occurredAt: createdAt },
    },
    userId,
  );
}

const ids = (actions: { id: string }[]) => actions.map((action) => action.id);

const QUEUE_KEY = 'trips.offlineQueue';

async function storeRaw(entries: unknown[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
}

// A fixed clock for every default `nowMs` — only this spy is restored after
// each test (restoring all mocks would also strip the AsyncStorage mock).
let clock: ReturnType<typeof jest.spyOn>;

beforeEach(async () => {
  clock = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  await AsyncStorage.clear();
});

afterEach(() => {
  clock.mockRestore();
});

describe('offline trip queue storage', () => {
  it('reads an empty queue when nothing is stored', async () => {
    expect(await getQueuedActionsForTrip('trip-a', ALI)).toEqual([]);
  });

  it('stamps a draft as a v2 item owned by its user, with no attempts yet', () => {
    expect(createQueuedAction({ id: 's1', kind: 'start', tripId: 'trip-a', createdAt: QUEUED_AT }, ALI)).toEqual({
      v: 2,
      id: 's1',
      kind: 'start',
      tripId: 'trip-a',
      createdAt: QUEUED_AT,
      userId: ALI,
      attemptCount: 0,
    });
  });

  it('round-trips an action unchanged', async () => {
    const action = pickupAction('e1', 'trip-a');
    await enqueueTripAction(action);
    expect(await getQueuedActionsForTrip('trip-a', ALI)).toEqual([action]);
  });

  it('keeps insertion (FIFO) order and filters by trip', async () => {
    await enqueueTripAction(startAction('a1', 'trip-a'));
    await enqueueTripAction(pickupAction('b1', 'trip-b'));
    await enqueueTripAction(pickupAction('a2', 'trip-a'));
    await enqueueTripAction(pickupAction('a3', 'trip-a'));

    expect(ids(await getQueuedActionsForTrip('trip-a', ALI))).toEqual(['a1', 'a2', 'a3']);
    expect(ids(await getQueuedActionsForTrip('trip-b', ALI))).toEqual(['b1']);
    expect(await getQueuedActionsForTrip('trip-c', ALI)).toEqual([]);
  });

  it('ignores a second enqueue of an id that is already queued', async () => {
    await enqueueTripAction(pickupAction('a1', 'trip-a'));
    await enqueueTripAction(pickupAction('a1', 'trip-a'));
    expect(ids(await getQueuedActionsForTrip('trip-a', ALI))).toEqual(['a1']);
  });

  it('removes only the given id and keeps the rest in order', async () => {
    await enqueueTripAction(startAction('a1', 'trip-a'));
    await enqueueTripAction(pickupAction('b1', 'trip-b'));
    await enqueueTripAction(pickupAction('a2', 'trip-a'));

    await removeQueuedAction('a1');

    expect(ids(await getQueuedActionsForTrip('trip-a', ALI))).toEqual(['a2']);
    expect(ids(await getQueuedActionsForTrip('trip-b', ALI))).toEqual(['b1']);
  });

  it('treats removing an id that is already gone as a no-op', async () => {
    await enqueueTripAction(startAction('a1', 'trip-a'));
    await removeQueuedAction('missing');
    await removeQueuedAction('a1');
    await removeQueuedAction('a1');
    expect(await getQueuedActionsForTrip('trip-a', ALI)).toEqual([]);
  });

  it.each([
    ['corrupt JSON', '{not json'],
    ['a non-array value', '{"id":"a1"}'],
  ])('reads %s as an empty queue', async (_label, raw) => {
    await AsyncStorage.setItem(QUEUE_KEY, raw);
    expect(await getQueuedActionsForTrip('trip-a', ALI)).toEqual([]);
  });

  it('skips unreadable entries and drops them on the next write', async () => {
    const good = pickupAction('a1', 'trip-a');
    await storeRaw([42, { id: 'x' }, good, { v: 2, kind: 'event', id: 'no-payload', tripId: 'trip-a' }]);

    expect(ids(await getQueuedActionsForTrip('trip-a', ALI))).toEqual(['a1']);
    await enqueueTripAction(pickupAction('a2', 'trip-a'));
    expect(JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) as string)).toHaveLength(2);
  });

  it('notifies subscribers after every write', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeQueueChanges(listener);

    await enqueueTripAction(pickupAction('a1', 'trip-a'));
    await removeQueuedAction('a1');
    unsubscribe();
    await enqueueTripAction(pickupAction('a2', 'trip-a'));

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('user scoping', () => {
  it("never returns another user's actions", async () => {
    await enqueueTripAction(pickupAction('ali-1', 'trip-a', ALI));
    await enqueueTripAction(pickupAction('sara-1', 'trip-a', SARA));
    await enqueueTripAction(startAction('sara-2', 'trip-b', SARA));

    expect(ids(await getQueuedActionsForTrip('trip-a', ALI))).toEqual(['ali-1']);
    expect(ids(await getQueuedActionsForTrip('trip-a', SARA))).toEqual(['sara-1']);
    expect(ids(await getQueuedActionsForUser(ALI))).toEqual(['ali-1']);
    expect(ids(await getQueuedActionsForUser(SARA))).toEqual(['sara-1', 'sara-2']);
  });

  it("scopes the dropped-action log to its user and trip, and dismisses only that user's", async () => {
    await dropQueuedAction(pickupAction('ali-1', 'trip-a', ALI), 'rejected', 'Nope', NOW);
    await dropQueuedAction(pickupAction('sara-1', 'trip-a', SARA), 'rejected', 'Nope', NOW);
    await dropQueuedAction(pickupAction('ali-2', 'trip-b', ALI), 'expired', null, NOW);

    expect(ids(await getDroppedActions(ALI, 'trip-a', NOW))).toEqual(['ali-1']);
    await dismissDroppedActions(ALI, 'trip-a', NOW);

    expect(await getDroppedActions(ALI, 'trip-a', NOW)).toEqual([]);
    expect(ids(await getDroppedActions(SARA, 'trip-a', NOW))).toEqual(['sara-1']);
    expect(ids(await getDroppedActions(ALI, 'trip-b', NOW))).toEqual(['ali-2']);
  });
});

describe('lock', () => {
  // Without the lock, both read the same list and the enqueue's stale write
  // resurrected the removed action (the other interleaving lost the new one).
  it('applies a concurrent remove and enqueue without a lost update', async () => {
    await enqueueTripAction(startAction('a1', 'trip-a'));

    await Promise.all([removeQueuedAction('a1'), enqueueTripAction(pickupAction('a2', 'trip-a'))]);

    expect(ids(await getQueuedActionsForTrip('trip-a', ALI))).toEqual(['a2']);
  });

  it('keeps every one of many concurrent enqueues, in call order', async () => {
    const actions = Array.from({ length: 10 }, (_, i) => pickupAction(`p${i}`, 'trip-a'));
    await Promise.all(actions.map((action) => enqueueTripAction(action)));
    expect(ids(await getQueuedActionsForTrip('trip-a', ALI))).toEqual(ids(actions));
  });

  it('does not lose an enqueue that races an attempt update or a drop', async () => {
    await enqueueTripAction(pickupAction('a1', 'trip-a'));
    await enqueueTripAction(pickupAction('a2', 'trip-a'));

    await Promise.all([
      recordFailedAttempt('a1', 'network', NOW),
      dropQueuedAction(pickupAction('a2', 'trip-a'), 'rejected', 'Nope', NOW),
      enqueueTripAction(pickupAction('a3', 'trip-a')),
    ]);

    const queue = await getQueuedActionsForTrip('trip-a', ALI);
    expect(ids(queue)).toEqual(['a1', 'a3']);
    expect(queue[0].attemptCount).toBe(1);
  });
});

describe('legacy (pre-v2) items', () => {
  function legacyPickup(id: string, queuedAt: string) {
    return {
      id,
      kind: 'event',
      tripId: 'trip-a',
      queuedAt,
      payload: { id, tripInquiryId: 'inq-1', type: TripEventType.PICKUP, occurredAt: queuedAt },
    };
  }

  it('adopts a fresh legacy item for the user who reads first, in its original FIFO position', async () => {
    const fresh = new Date(NOW - HOUR).toISOString();
    await storeRaw([
      { id: 'old-start', kind: 'start', tripId: 'trip-a', queuedAt: fresh },
      pickupAction('v2-pickup', 'trip-a'),
      legacyPickup('old-pickup', fresh),
    ]);

    const queue = await getQueuedActionsForTrip('trip-a', ALI, NOW);

    expect(ids(queue)).toEqual(['old-start', 'v2-pickup', 'old-pickup']);
    expect(queue[0]).toEqual({ v: 2, id: 'old-start', kind: 'start', tripId: 'trip-a', createdAt: fresh, userId: ALI, attemptCount: 0 });
    expect(queue[2]).toMatchObject({ v: 2, userId: ALI, createdAt: fresh, attemptCount: 0 });
    expect(queue[2]).not.toHaveProperty('queuedAt');
    // Adopted for good — the next account doesn't see them.
    expect(await getQueuedActionsForTrip('trip-a', SARA, NOW)).toEqual([]);
  });

  it('discards a legacy item older than the TTL and reports it to the adopting user', async () => {
    const stale = new Date(NOW - OFFLINE_QUEUE_TTL_MS - 1).toISOString();
    await storeRaw([legacyPickup('stale', stale), legacyPickup('fresh', QUEUED_AT)]);

    expect(ids(await getQueuedActionsForTrip('trip-a', ALI, NOW))).toEqual(['fresh']);
    expect(await getDroppedActions(ALI, 'trip-a', NOW)).toEqual([
      expect.objectContaining({ id: 'stale', reason: 'expired', eventType: TripEventType.PICKUP, tripInquiryId: 'inq-1' }),
    ]);
  });
});

describe('retention policy', () => {
  it('expires an action strictly older than 24 h, and one with an unreadable timestamp', () => {
    const createdAt = new Date(NOW - OFFLINE_QUEUE_TTL_MS).toISOString();
    expect(isExpired(createdAt, NOW)).toBe(false);
    expect(isExpired(createdAt, NOW + 1)).toBe(true);
    expect(isExpired('not a date', NOW)).toBe(true);
  });

  it('backs off 15 s, doubling, capped at 1 h', () => {
    expect([0, 1, 2, 3, 8, 9, 10, 19].map(retryDelayMs)).toEqual([
      0, 15_000, 30_000, 60_000, 1_920_000, 3_600_000, 3_600_000, 3_600_000,
    ]);
  });

  it('counts a failure only once the backoff window since the last counted one has passed', () => {
    const fresh = pickupAction('a1', 'trip-a');
    expect(shouldCountAttempt(fresh, NOW)).toBe(true);

    const failedTwice = { ...fresh, attemptCount: 2, lastAttemptAt: QUEUED_AT };
    expect(shouldCountAttempt(failedTwice, NOW + 29_999)).toBe(false);
    expect(shouldCountAttempt(failedTwice, NOW + 30_000)).toBe(true);
  });

  it('spends 20 counted attempts over roughly 12 h of continuous failure', () => {
    const total = Array.from({ length: OFFLINE_QUEUE_MAX_ATTEMPTS - 1 }, (_, i) => retryDelayMs(i + 1)).reduce(
      (sum, delay) => sum + delay,
      0,
    );
    expect(total / HOUR).toBeGreaterThan(11);
    expect(total).toBeLessThan(OFFLINE_QUEUE_TTL_MS);
  });
});

describe('recordFailedAttempt', () => {
  it('counts the first failure and stamps its time and kind', async () => {
    await enqueueTripAction(pickupAction('a1', 'trip-a'));

    expect(await recordFailedAttempt('a1', 'server', NOW)).toMatchObject({
      attemptCount: 1,
      lastAttemptAt: QUEUED_AT,
      lastErrorKind: 'server',
    });
  });

  it('only updates the error kind for a failure inside the backoff window', async () => {
    await enqueueTripAction(pickupAction('a1', 'trip-a'));
    await recordFailedAttempt('a1', 'network', NOW);

    expect(await recordFailedAttempt('a1', 'rate_limited', NOW + 5_000)).toMatchObject({
      attemptCount: 1,
      lastAttemptAt: QUEUED_AT,
      lastErrorKind: 'rate_limited',
    });
    expect(await recordFailedAttempt('a1', 'network', NOW + 15_000)).toMatchObject({ attemptCount: 2 });
  });

  it('resolves null for an action that is no longer queued', async () => {
    expect(await recordFailedAttempt('missing', 'network', NOW)).toBeNull();
  });
});

describe('pruneQueue', () => {
  it("drops every user's expired or out-of-attempts actions, logs each for its own user, keeps the rest in order", async () => {
    const stale = new Date(NOW - OFFLINE_QUEUE_TTL_MS - 1).toISOString();
    await enqueueTripAction(pickupAction('keep-1', 'trip-a'));
    await enqueueTripAction(pickupAction('stale-ali', 'trip-a', ALI, stale));
    await enqueueTripAction({ ...pickupAction('spent', 'trip-a'), attemptCount: OFFLINE_QUEUE_MAX_ATTEMPTS });
    await enqueueTripAction({ ...pickupAction('almost', 'trip-a'), attemptCount: OFFLINE_QUEUE_MAX_ATTEMPTS - 1 });
    await enqueueTripAction(startAction('stale-sara', 'trip-b', SARA, stale));

    const dropped = await pruneQueue(NOW);

    expect(dropped.map((entry) => [entry.id, entry.userId, entry.reason])).toEqual([
      ['stale-ali', ALI, 'expired'],
      ['spent', ALI, 'max_attempts'],
      ['stale-sara', SARA, 'expired'],
    ]);
    expect(ids(await getQueuedActionsForTrip('trip-a', ALI))).toEqual(['keep-1', 'almost']);
    expect(ids(await getDroppedActions(ALI, 'trip-a', NOW))).toEqual(['stale-ali', 'spent']);
    expect(ids(await getDroppedActions(SARA, 'trip-b', NOW))).toEqual(['stale-sara']);
  });

  it('forgets dropped-log entries after a week', async () => {
    await dropQueuedAction(pickupAction('a1', 'trip-a'), 'rejected', 'Nope', NOW);
    expect(await getDroppedActions(ALI, 'trip-a', NOW + 8 * 24 * HOUR)).toEqual([]);
  });
});
