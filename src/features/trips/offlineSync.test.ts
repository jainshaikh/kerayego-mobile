import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { tripsApi, type TripEvent } from '../../api/trips.api';
import {
  OFFLINE_QUEUE_MAX_ATTEMPTS,
  OFFLINE_QUEUE_TTL_MS,
  createQueuedAction,
  enqueueTripAction,
  getDroppedActions,
  getQueuedActionsForTrip,
  type QueuedTripAction,
  type TripActionDraft,
} from '../../storage/offline-trip-queue';
import type { TripDetail } from '../../types/api.types';
import { TripEventType, TripStatus } from '../../types/enums';
import {
  flushAllTripQueues,
  flushOnce,
  flushTripQueue,
  runTripAction,
  setOfflineQueueOwner,
  type TripActionQueue,
} from './offlineSync';

// Only the four day-of endpoints flushOnce touches — keeps axios/SecureStore
// (api/client.ts) out of the test entirely. AsyncStorage is the in-memory
// mock registered in jest.setup.ts.
jest.mock('../../api/trips.api', () => ({
  tripsApi: {
    startTrip: jest.fn(),
    endTrip: jest.fn(),
    recordEvent: jest.fn(),
    getMineOne: jest.fn(),
  },
}));

const api = jest.mocked(tripsApi);

const TRIP = 'trip-a';
const USER = 'user-ali';
const OTHER_USER = 'user-sara';
const NOW = Date.parse('2026-10-08T09:00:00.000Z');
const QUEUED_AT = new Date(NOW).toISOString();
const clock = () => NOW;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function start(id: string, tripId = TRIP, userId = USER): QueuedTripAction {
  return createQueuedAction({ id, kind: 'start', tripId, createdAt: QUEUED_AT }, userId);
}

function end(id: string, tripId = TRIP, userId = USER): QueuedTripAction {
  return createQueuedAction({ id, kind: 'end', tripId, createdAt: QUEUED_AT }, userId);
}

function eventDraft(id: string, type: TripEventType, tripId = TRIP, tripInquiryId = 'inq-1'): TripActionDraft {
  return { id, kind: 'event', tripId, createdAt: QUEUED_AT, payload: { id, tripInquiryId, type, occurredAt: QUEUED_AT } };
}

function event(id: string, type: TripEventType, tripId = TRIP, userId = USER): QueuedTripAction {
  return createQueuedAction(eventDraft(id, type, tripId), userId);
}

function trip(status: TripStatus): TripDetail {
  return { id: TRIP, status } as TripDetail;
}

// No response at all — what normalizeApiError reads as kind 'network'.
function networkError(): AxiosError {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK);
}

// A server reply with the backend's error envelope.
function httpError(status: number, message = `HTTP ${status}`): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_RESPONSE, config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, statusCode: status, error: { code: 'ERR', message }, timestamp: QUEUED_AT, path: '/' },
  });
}

async function queueOf(...actions: QueuedTripAction[]) {
  for (const action of actions) await enqueueTripAction(action);
}

async function remaining(tripId = TRIP, userId = USER) {
  return getQueuedActionsForTrip(tripId, userId, NOW);
}

async function remainingIds(tripId = TRIP, userId = USER) {
  return (await remaining(tripId, userId)).map((action) => action.id);
}

async function droppedIds(tripId = TRIP, userId = USER) {
  return (await getDroppedActions(userId, tripId, NOW)).map((entry) => entry.id);
}

// Records every endpoint hit in order so FIFO replay can be asserted directly.
function recordCalls() {
  const calls: string[] = [];
  api.startTrip.mockImplementation(async (id) => {
    calls.push(`start:${id}`);
    return trip(TripStatus.IN_PROGRESS);
  });
  api.endTrip.mockImplementation(async (id) => {
    calls.push(`end:${id}`);
    return trip(TripStatus.COMPLETED);
  });
  api.recordEvent.mockImplementation(async (id, payload) => {
    calls.push(`${payload.type}:${payload.id}`);
    return { id: payload.id, tripId: id } as TripEvent;
  });
  return calls;
}

function fakeQueryClient() {
  const invalidateQueries = jest.fn(async (_filters: { queryKey: unknown[] }) => {});
  return { client: { invalidateQueries } as unknown as QueryClient, invalidateQueries };
}

beforeEach(async () => {
  // Reset only the API mocks — jest.resetAllMocks() would also strip the
  // AsyncStorage mock's in-memory implementation.
  api.startTrip.mockReset();
  api.endTrip.mockReset();
  api.recordEvent.mockReset();
  api.getMineOne.mockReset();
  await AsyncStorage.clear();
  // A fresh session per test (also forgets the previous test's applied actions).
  setOfflineQueueOwner(null);
  setOfflineQueueOwner(USER);
});

// ─── flushOnce ───────────────────────────────────────────────────────────────

describe('flushOnce', () => {
  it('does nothing for an empty queue', async () => {
    expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 0, failed: 0, blocked: false });
    expect(api.startTrip).not.toHaveBeenCalled();
  });

  it('replays start, pickup, drop-off, end in FIFO order and empties the queue', async () => {
    const calls = recordCalls();
    await queueOf(start('s'), event('p', TripEventType.PICKUP), event('d', TripEventType.DROPOFF), end('e'));

    const result = await flushOnce(TRIP, USER, clock);

    expect(result).toMatchObject({ flushed: 4, failed: 0, blocked: false });
    expect(result.applied.map((action) => action.id)).toEqual(['s', 'p', 'd', 'e']);
    expect(calls).toEqual([`start:${TRIP}`, 'PICKUP:p', 'DROPOFF:d', `end:${TRIP}`]);
    expect(await remainingIds()).toEqual([]);
  });

  it('leaves actions queued for other trips untouched', async () => {
    const calls = recordCalls();
    await queueOf(event('b1', TripEventType.PICKUP, 'trip-b'), event('a1', TripEventType.PICKUP));

    expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 1, failed: 0 });
    expect(calls).toEqual(['PICKUP:a1']);
    expect(await remainingIds('trip-b')).toEqual(['b1']);
  });

  it("never replays another user's actions, even on the same trip", async () => {
    const calls = recordCalls();
    await queueOf(event('sara-1', TripEventType.ARRIVED, TRIP, OTHER_USER), event('ali-1', TripEventType.PICKUP));

    expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 1 });
    expect(calls).toEqual(['PICKUP:ali-1']);
    expect(await remainingIds(TRIP, OTHER_USER)).toEqual(['sara-1']);
  });

  it('replays nothing for a user who is not the signed-in queue owner', async () => {
    recordCalls();
    await queueOf(event('p', TripEventType.PICKUP));
    setOfflineQueueOwner(OTHER_USER);

    expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 0, failed: 0 });
    expect(api.recordEvent).not.toHaveBeenCalled();
  });

  it('stops at a network failure in the middle: keeps it and everything after it, in order, and records the attempt', async () => {
    const calls = recordCalls();
    const recordAndSucceed = api.recordEvent.getMockImplementation()!;
    api.recordEvent.mockImplementationOnce(recordAndSucceed).mockRejectedValueOnce(networkError());
    await queueOf(
      event('p1', TripEventType.PICKUP),
      event('p2', TripEventType.PICKUP),
      event('d1', TripEventType.DROPOFF),
      end('e'),
    );

    expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 1, failed: 0, blocked: true });
    expect(calls).toEqual(['PICKUP:p1']);
    expect(api.recordEvent).toHaveBeenCalledTimes(2);
    expect(api.endTrip).not.toHaveBeenCalled();
    const left = await remaining();
    expect(left.map((action) => action.id)).toEqual(['p2', 'd1', 'e']);
    expect(left[0]).toMatchObject({ attemptCount: 1, lastErrorKind: 'network', lastAttemptAt: QUEUED_AT });
    expect(left[1].attemptCount).toBe(0);

    // Back online: the next flush resumes exactly where this one stopped.
    expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 3, blocked: false });
    expect(calls).toEqual(['PICKUP:p1', 'PICKUP:p2', 'DROPOFF:d1', `end:${TRIP}`]);
  });

  it('drops a refused event, records why, and carries on with the next one', async () => {
    const calls = recordCalls();
    api.recordEvent.mockRejectedValueOnce(httpError(400, 'This trip is not in progress'));
    await queueOf(event('bad', TripEventType.PICKUP), event('ok', TripEventType.DROPOFF));

    const result = await flushOnce(TRIP, USER, clock);

    expect(result).toMatchObject({ flushed: 1, failed: 1, blocked: false });
    expect(result.dropped).toEqual([
      expect.objectContaining({
        id: 'bad',
        userId: USER,
        reason: 'rejected',
        message: 'This trip is not in progress',
        eventType: TripEventType.PICKUP,
        tripInquiryId: 'inq-1',
      }),
    ]);
    expect(calls).toEqual(['DROPOFF:ok']);
    expect(await remainingIds()).toEqual([]);
    expect(await droppedIds()).toEqual(['bad']);
  });

  describe('error classification', () => {
    // [label, expected, error]: 'retry' keeps the action (and everything after
    // it) queued and stops; 'drop' discards it and continues.
    it.each<[string, 'retry' | 'drop', () => AxiosError]>([
      ['no response (network)', 'retry', () => networkError()],
      ['500', 'retry', () => httpError(500)],
      ['502', 'retry', () => httpError(502)],
      ['503', 'retry', () => httpError(503)],
      ['429', 'retry', () => httpError(429)],
      ['401', 'retry', () => httpError(401)],
      ['408 (unmapped status)', 'retry', () => httpError(408)],
      ['400', 'drop', () => httpError(400)],
      ['422', 'drop', () => httpError(422)],
      ['403', 'drop', () => httpError(403)],
      ['404', 'drop', () => httpError(404)],
      ['409 (event id reused for different content)', 'drop', () => httpError(409)],
    ])('on %s it should %s', async (_label, expected, makeError) => {
      const calls = recordCalls();
      api.recordEvent.mockRejectedValueOnce(makeError());
      await queueOf(event('p', TripEventType.PICKUP), event('d', TripEventType.DROPOFF));

      const result = await flushOnce(TRIP, USER, clock);

      if (expected === 'retry') {
        expect(result).toMatchObject({ flushed: 0, failed: 0, blocked: true });
        expect(api.recordEvent).toHaveBeenCalledTimes(1);
        expect(await remainingIds()).toEqual(['p', 'd']);
        expect((await remaining())[0].attemptCount).toBe(1);
      } else {
        expect(result).toMatchObject({ flushed: 1, failed: 1, blocked: false });
        expect(calls).toEqual(['DROPOFF:d']);
        expect(await remainingIds()).toEqual([]);
        expect(await droppedIds()).toEqual(['p']);
      }
    });
  });

  describe('retention', () => {
    it('discards an action older than 24 h without sending it, and reports it', async () => {
      recordCalls();
      const stale = createQueuedAction(
        { ...eventDraft('old', TripEventType.PICKUP), createdAt: new Date(NOW - OFFLINE_QUEUE_TTL_MS - 1).toISOString() },
        USER,
      );
      await queueOf(stale, event('fresh', TripEventType.DROPOFF));

      const result = await flushOnce(TRIP, USER, clock);

      expect(result.dropped).toEqual([expect.objectContaining({ id: 'old', reason: 'expired' })]);
      expect(result.applied.map((action) => action.id)).toEqual(['fresh']);
      expect(api.recordEvent).toHaveBeenCalledTimes(1);
    });

    it('discards an action on its 20th counted failure, and keeps the rest queued', async () => {
      api.recordEvent.mockRejectedValue(httpError(503));
      await queueOf(
        { ...event('p', TripEventType.PICKUP), attemptCount: OFFLINE_QUEUE_MAX_ATTEMPTS - 1 },
        event('d', TripEventType.DROPOFF),
      );

      const result = await flushOnce(TRIP, USER, clock);

      expect(result).toMatchObject({ failed: 1, blocked: true });
      expect(result.dropped).toEqual([expect.objectContaining({ id: 'p', reason: 'max_attempts' })]);
      expect(await remainingIds()).toEqual(['d']);
    });

    it("doesn't count a retry inside the backoff window, so quick retries while offline don't burn attempts", async () => {
      api.recordEvent.mockRejectedValue(networkError());
      await queueOf(event('p', TripEventType.PICKUP));

      await flushOnce(TRIP, USER, () => NOW);
      await flushOnce(TRIP, USER, () => NOW + 5_000);
      await flushOnce(TRIP, USER, () => NOW + 10_000);
      expect((await remaining())[0].attemptCount).toBe(1);

      await flushOnce(TRIP, USER, () => NOW + 15_000);
      expect((await remaining())[0].attemptCount).toBe(2);
    });
  });

  describe('start/end reconcile against GET /my/trips/:id', () => {
    it.each<['start' | 'end', TripStatus, 'applied' | 'dropped']>([
      ['start', TripStatus.IN_PROGRESS, 'applied'],
      ['start', TripStatus.COMPLETED, 'applied'],
      ['start', TripStatus.ACTIVE, 'dropped'],
      ['start', TripStatus.CANCELLED, 'dropped'],
      ['start', TripStatus.SUSPENDED, 'dropped'],
      ['end', TripStatus.COMPLETED, 'applied'],
      ['end', TripStatus.IN_PROGRESS, 'dropped'],
      ['end', TripStatus.CANCELLED, 'dropped'],
    ])('counts a refused %s on a %s trip as %s', async (kind, status, expected) => {
      const refusal = httpError(400, `Trip in status "${status}" cannot be changed`);
      if (kind === 'start') api.startTrip.mockRejectedValueOnce(refusal);
      else api.endTrip.mockRejectedValueOnce(refusal);
      api.getMineOne.mockResolvedValueOnce(trip(status));
      await queueOf(kind === 'start' ? start('x') : end('x'));

      const result = await flushOnce(TRIP, USER, clock);

      expect(api.getMineOne).toHaveBeenCalledWith(TRIP);
      expect(await remainingIds()).toEqual([]);
      if (expected === 'applied') {
        expect(result).toMatchObject({ flushed: 1, failed: 0 });
      } else {
        expect(result).toMatchObject({ flushed: 0, failed: 1 });
        expect(result.dropped[0]).toMatchObject({ reason: 'rejected', message: `Trip in status "${status}" cannot be changed` });
      }
    });

    it.each([
      ['a network error', () => networkError()],
      ['a 503', () => httpError(503)],
    ])('keeps the action queued when the reconcile GET fails with %s', async (_label, makeError) => {
      api.startTrip.mockRejectedValueOnce(httpError(400));
      api.getMineOne.mockRejectedValueOnce(makeError());
      await queueOf(start('s'), event('p', TripEventType.PICKUP));

      expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 0, failed: 0, blocked: true });
      expect(api.recordEvent).not.toHaveBeenCalled();
      expect(await remainingIds()).toEqual(['s', 'p']);
    });

    it.each([403, 404])('drops the action instead of blocking the queue forever when the reconcile GET is a %s', async (status) => {
      recordCalls();
      api.startTrip.mockRejectedValueOnce(httpError(404, 'Trip not found'));
      api.getMineOne.mockRejectedValueOnce(httpError(status));
      await queueOf(start('s'), event('p', TripEventType.PICKUP));

      const result = await flushOnce(TRIP, USER, clock);

      expect(result.dropped).toEqual([expect.objectContaining({ id: 's', reason: 'rejected', message: 'Trip not found' })]);
      expect(api.recordEvent).toHaveBeenCalledTimes(1);
      expect(await remainingIds()).toEqual([]);
    });
  });

  describe('session changes mid-flush', () => {
    it('stops without sending the rest once the signed-in user changes', async () => {
      const calls = recordCalls();
      api.recordEvent.mockImplementationOnce(async (id, payload) => {
        calls.push(`${payload.type}:${payload.id}`);
        setOfflineQueueOwner(null); // logged out while this request was in flight
        return { id: payload.id, tripId: id } as TripEvent;
      });
      await queueOf(event('p1', TripEventType.PICKUP), event('p2', TripEventType.PICKUP));

      expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 1 });
      expect(calls).toEqual(['PICKUP:p1']);
      expect(await remainingIds()).toEqual(['p2']);
    });

    it("doesn't drop an action over a refusal that arrives after the user changed", async () => {
      api.recordEvent.mockImplementationOnce(async () => {
        setOfflineQueueOwner(OTHER_USER);
        throw httpError(404);
      });
      await queueOf(event('p1', TripEventType.PICKUP));

      expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 0, failed: 0 });
      expect(await remainingIds()).toEqual(['p1']);
      expect(await droppedIds()).toEqual([]);
    });
  });

  it('adopts and replays a legacy (pre-v2) item for the signed-in user', async () => {
    const calls = recordCalls();
    await AsyncStorage.setItem(
      'trips.offlineQueue',
      JSON.stringify([
        {
          id: 'legacy',
          kind: 'event',
          tripId: TRIP,
          queuedAt: QUEUED_AT,
          payload: { id: 'legacy', tripInquiryId: 'inq-1', type: TripEventType.PICKUP, occurredAt: QUEUED_AT },
        },
      ]),
    );

    expect(await flushOnce(TRIP, USER, clock)).toMatchObject({ flushed: 1 });
    expect(calls).toEqual(['PICKUP:legacy']);
  });
});

// ─── flushTripQueue / flushAllTripQueues ─────────────────────────────────────

describe('flushTripQueue', () => {
  it('invalidates the trip, trip list, manifest, active ride and each touched inquiry after a replay', async () => {
    recordCalls();
    api.recordEvent.mockRejectedValueOnce(httpError(409, 'Reused id'));
    await queueOf(
      createQueuedAction(eventDraft('rejected', TripEventType.PICKUP, TRIP, 'inq-9'), USER),
      createQueuedAction(eventDraft('ok', TripEventType.DROPOFF, TRIP, 'inq-1'), USER),
    );
    const { client, invalidateQueries } = fakeQueryClient();

    await flushTripQueue(TRIP, USER, client);

    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      ['myTrips'],
      ['myTrip', TRIP],
      ['tripManifest', TRIP],
      ['myActiveRide'],
      ['tripInquiry', 'inq-1'],
      ['tripInquiry', 'inq-9'],
    ]);
  });

  it('invalidates nothing when nothing was replayed or dropped', async () => {
    api.recordEvent.mockRejectedValue(networkError());
    await queueOf(event('p', TripEventType.PICKUP));
    const { client, invalidateQueries } = fakeQueryClient();

    await flushTripQueue(TRIP, USER, client);

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('joins a flush already running instead of replaying the same actions twice, then makes one more pass', async () => {
    const calls = recordCalls();
    const recordAndSucceed = api.recordEvent.getMockImplementation()!;
    let releaseFirstRequest = () => {};
    const firstRequestHeld = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    api.recordEvent.mockImplementationOnce(async (id, payload) => {
      await firstRequestHeld;
      return recordAndSucceed(id, payload);
    });
    await queueOf(event('p1', TripEventType.PICKUP));
    const { client } = fakeQueryClient();

    const first = flushTripQueue(TRIP, USER, client);
    while (api.recordEvent.mock.calls.length === 0) await Promise.resolve();
    // Queued after the running pass already read the list — the joined call's
    // extra pass is what sends it now rather than on the next trigger.
    await enqueueTripAction(event('p2', TripEventType.PICKUP));
    const second = flushTripQueue(TRIP, USER, client);
    releaseFirstRequest();
    await Promise.all([first, second]);

    expect(calls).toEqual(['PICKUP:p1', 'PICKUP:p2']);
    expect(api.recordEvent).toHaveBeenCalledTimes(2);
    expect(await remainingIds()).toEqual([]);
  });

  it("doesn't make the extra pass when the running one stopped at a transient failure", async () => {
    let rejectFirstRequest: (error: unknown) => void = () => {};
    api.recordEvent.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirstRequest = reject;
        }),
    );
    await queueOf(event('p1', TripEventType.PICKUP));
    const { client } = fakeQueryClient();

    const first = flushTripQueue(TRIP, USER, client);
    while (api.recordEvent.mock.calls.length === 0) await Promise.resolve();
    const second = flushTripQueue(TRIP, USER, client);
    rejectFirstRequest(networkError());
    await Promise.all([first, second]);

    expect(api.recordEvent).toHaveBeenCalledTimes(1);
    expect(await remainingIds()).toEqual(['p1']);
  });
});

describe('flushAllTripQueues', () => {
  it("flushes every trip the user has queued actions for, and no one else's", async () => {
    const calls = recordCalls();
    await queueOf(
      event('a1', TripEventType.PICKUP, 'trip-a'),
      event('b1', TripEventType.PICKUP, 'trip-b'),
      event('c1', TripEventType.PICKUP, 'trip-c', OTHER_USER),
      event('a2', TripEventType.DROPOFF, 'trip-a'),
    );

    await flushAllTripQueues(USER, fakeQueryClient().client);

    expect(calls).toEqual(['PICKUP:a1', 'DROPOFF:a2', 'PICKUP:b1']);
    expect(await remainingIds('trip-c', OTHER_USER)).toEqual(['c1']);
  });
});

// ─── runTripAction ───────────────────────────────────────────────────────────

describe('runTripAction', () => {
  function harness(pendingAhead = 0) {
    const queue = {
      enqueue: jest.fn<TripActionQueue['enqueue']>(async () => {}),
      countPending: jest.fn<TripActionQueue['countPending']>(async () => pendingAhead),
      recordApplied: jest.fn<TripActionQueue['recordApplied']>(),
    };
    return {
      queue,
      setActionError: jest.fn<(message: string | null) => void>(),
      onSuccess: jest.fn<(result: string) => void>(),
      onQueued: jest.fn<() => void>(),
      offline: eventDraft('p', TripEventType.PICKUP),
    };
  }

  type Harness = ReturnType<typeof harness>;

  function run(h: Harness, mutate: () => Promise<string>) {
    return runTripAction(mutate, h.queue, () => h.offline, h.setActionError, { onSuccess: h.onSuccess, onQueued: h.onQueued });
  }

  it('reports success, remembers the action as applied, and queues nothing', async () => {
    const h = harness();
    await run(h, async () => 'ok');

    expect(h.onSuccess).toHaveBeenCalledWith('ok');
    expect(h.queue.recordApplied).toHaveBeenCalledWith(h.offline);
    expect(h.queue.enqueue).not.toHaveBeenCalled();
    expect(h.onQueued).not.toHaveBeenCalled();
    expect(h.setActionError.mock.calls).toEqual([[null]]);
  });

  it('queues the offline action on a network error instead of surfacing it', async () => {
    const h = harness();
    await run(h, async () => {
      throw networkError();
    });

    expect(h.queue.enqueue).toHaveBeenCalledWith(h.offline);
    expect(h.onQueued).toHaveBeenCalledTimes(1);
    expect(h.onSuccess).not.toHaveBeenCalled();
    expect(h.queue.recordApplied).not.toHaveBeenCalled();
    expect(h.setActionError.mock.calls).toEqual([[null]]);
  });

  it('surfaces the backend message for a rejected action and queues nothing', async () => {
    const h = harness();
    await run(h, async () => {
      throw httpError(400, 'This trip is not in progress');
    });

    expect(h.queue.enqueue).not.toHaveBeenCalled();
    expect(h.onQueued).not.toHaveBeenCalled();
    expect(h.setActionError.mock.calls).toEqual([[null], ['This trip is not in progress']]);
  });

  it('queues behind older pending actions for the trip without sending it directly (strict FIFO)', async () => {
    const h = harness(2);
    const mutate = jest.fn(async () => 'ok');
    await run(h, mutate);

    expect(mutate).not.toHaveBeenCalled();
    expect(h.queue.enqueue).toHaveBeenCalledWith(h.offline);
    expect(h.onQueued).toHaveBeenCalledTimes(1);
  });

  it('reports a failure to save the action rather than pretending it was queued', async () => {
    const h = harness();
    h.queue.enqueue.mockRejectedValueOnce(new Error('disk full'));
    await run(h, async () => {
      throw networkError();
    });

    expect(h.onQueued).not.toHaveBeenCalled();
    expect(h.setActionError).toHaveBeenLastCalledWith('No connection. Check your internet and try again.');
  });

  it('sends directly when the pending count cannot be read', async () => {
    const h = harness();
    h.queue.countPending.mockRejectedValueOnce(new Error('storage unavailable'));
    await run(h, async () => 'ok');

    expect(h.onSuccess).toHaveBeenCalledWith('ok');
  });
});

afterEach(() => {
  setOfflineQueueOwner(null);
});
