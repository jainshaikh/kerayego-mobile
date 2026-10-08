import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { tripsApi, type TripEvent } from '../../api/trips.api';
import { enqueueTripAction, getQueuedActionsForTrip, type QueuedTripAction } from '../../storage/offline-trip-queue';
import type { TripDetail } from '../../types/api.types';
import { TripEventType, TripStatus } from '../../types/enums';
import { flushOnce, runTripAction, type OfflineTripQueue } from './offlineSync';

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
const QUEUED_AT = '2026-10-08T09:00:00.000Z';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function start(id: string, tripId = TRIP): QueuedTripAction {
  return { id, kind: 'start', tripId, queuedAt: QUEUED_AT };
}

function end(id: string, tripId = TRIP): QueuedTripAction {
  return { id, kind: 'end', tripId, queuedAt: QUEUED_AT };
}

function event(id: string, type: TripEventType, tripId = TRIP): QueuedTripAction {
  return {
    id,
    kind: 'event',
    tripId,
    queuedAt: QUEUED_AT,
    payload: { id, tripInquiryId: 'inq-1', type, occurredAt: QUEUED_AT },
  };
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

async function remainingIds(tripId = TRIP) {
  return (await getQueuedActionsForTrip(tripId)).map((action) => action.id);
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

beforeEach(async () => {
  // Reset only the API mocks — jest.resetAllMocks() would also strip the
  // AsyncStorage mock's in-memory implementation.
  api.startTrip.mockReset();
  api.endTrip.mockReset();
  api.recordEvent.mockReset();
  api.getMineOne.mockReset();
  await AsyncStorage.clear();
});

// ─── flushOnce ───────────────────────────────────────────────────────────────

describe('flushOnce', () => {
  it('does nothing for an empty queue', async () => {
    expect(await flushOnce(TRIP)).toEqual({ flushed: 0, failed: 0 });
    expect(api.startTrip).not.toHaveBeenCalled();
  });

  it('replays start, pickup, drop-off, end in FIFO order and empties the queue', async () => {
    const calls = recordCalls();
    await queueOf(start('s'), event('p', TripEventType.PICKUP), event('d', TripEventType.DROPOFF), end('e'));

    expect(await flushOnce(TRIP)).toEqual({ flushed: 4, failed: 0 });
    expect(calls).toEqual([`start:${TRIP}`, 'PICKUP:p', 'DROPOFF:d', `end:${TRIP}`]);
    expect(await remainingIds()).toEqual([]);
  });

  it('leaves actions queued for other trips untouched', async () => {
    const calls = recordCalls();
    await queueOf(event('b1', TripEventType.PICKUP, 'trip-b'), event('a1', TripEventType.PICKUP));

    expect(await flushOnce(TRIP)).toEqual({ flushed: 1, failed: 0 });
    expect(calls).toEqual(['PICKUP:a1']);
    expect(await remainingIds('trip-b')).toEqual(['b1']);
  });

  it('stops at the first network error and keeps that action and the rest queued', async () => {
    const calls = recordCalls();
    const recordAndSucceed = api.recordEvent.getMockImplementation()!;
    api.recordEvent.mockImplementationOnce(recordAndSucceed).mockRejectedValueOnce(networkError());
    await queueOf(
      event('p1', TripEventType.PICKUP),
      event('p2', TripEventType.PICKUP),
      event('d1', TripEventType.DROPOFF),
    );

    expect(await flushOnce(TRIP)).toEqual({ flushed: 1, failed: 0 });
    expect(calls).toEqual(['PICKUP:p1']);
    expect(api.recordEvent).toHaveBeenCalledTimes(2);
    expect(await remainingIds()).toEqual(['p2', 'd1']);
  });

  it('drops an event the server rejects (400) and carries on with the next one', async () => {
    const calls = recordCalls();
    api.recordEvent.mockRejectedValueOnce(httpError(400, 'Validation failed'));
    await queueOf(event('bad', TripEventType.PICKUP), event('ok', TripEventType.DROPOFF));

    expect(await flushOnce(TRIP)).toEqual({ flushed: 1, failed: 1 });
    expect(calls).toEqual(['DROPOFF:ok']);
    expect(await remainingIds()).toEqual([]);
  });

  describe('start/end reconcile against GET /my/trips/:id', () => {
    it('counts a rejected start as applied when the trip is already IN_PROGRESS', async () => {
      api.startTrip.mockRejectedValueOnce(httpError(400));
      api.getMineOne.mockResolvedValueOnce(trip(TripStatus.IN_PROGRESS));
      await queueOf(start('s'));

      expect(await flushOnce(TRIP)).toEqual({ flushed: 1, failed: 0 });
      expect(api.getMineOne).toHaveBeenCalledWith(TRIP);
      expect(await remainingIds()).toEqual([]);
    });

    it('counts a rejected end as applied when the trip is already COMPLETED', async () => {
      api.endTrip.mockRejectedValueOnce(httpError(400));
      api.getMineOne.mockResolvedValueOnce(trip(TripStatus.COMPLETED));
      await queueOf(end('e'));

      expect(await flushOnce(TRIP)).toEqual({ flushed: 1, failed: 0 });
      expect(await remainingIds()).toEqual([]);
    });

    it('drops a rejected end as failed while the trip is still IN_PROGRESS', async () => {
      api.endTrip.mockRejectedValueOnce(httpError(400));
      api.getMineOne.mockResolvedValueOnce(trip(TripStatus.IN_PROGRESS));
      await queueOf(end('e'));

      expect(await flushOnce(TRIP)).toEqual({ flushed: 0, failed: 1 });
      expect(await remainingIds()).toEqual([]);
    });

    it('keeps the action queued when the reconcile GET itself fails', async () => {
      api.startTrip.mockRejectedValueOnce(httpError(400));
      api.getMineOne.mockRejectedValueOnce(networkError());
      await queueOf(start('s'), event('p', TripEventType.PICKUP));

      expect(await flushOnce(TRIP)).toEqual({ flushed: 0, failed: 0 });
      expect(api.recordEvent).not.toHaveBeenCalled();
      expect(await remainingIds()).toEqual(['s', 'p']);
    });

    // Known bug: any non-ACTIVE status (CANCELLED, SUSPENDED…) currently
    // counts a rejected start as "already applied". Flip to `it` once only
    // IN_PROGRESS/COMPLETED count.
    it.failing('does not count a rejected start as applied when the trip was CANCELLED', async () => {
      api.startTrip.mockRejectedValueOnce(httpError(400));
      api.getMineOne.mockResolvedValueOnce(trip(TripStatus.CANCELLED));
      await queueOf(start('s'));

      expect(await flushOnce(TRIP)).toEqual({ flushed: 0, failed: 1 });
    });
  });

  // Known bug: every non-network error is treated as permanent, so a 5xx
  // during a deploy, a throttler 429 or a 401 whose refresh failed deletes a
  // queued PICKUP/DROPOFF for good. Flip each to `it` once these are retried
  // (break and keep the action and everything after it queued).
  describe.each([
    ['a 503', 503],
    ['a 429', 429],
    ['a 401', 401],
  ])('on %s (transient)', (_label, status) => {
    it.failing('keeps the action and everything after it queued', async () => {
      recordCalls();
      api.recordEvent.mockRejectedValueOnce(httpError(status));
      await queueOf(event('p', TripEventType.PICKUP), event('d', TripEventType.DROPOFF));

      expect(await flushOnce(TRIP)).toEqual({ flushed: 0, failed: 0 });
      expect(api.recordEvent).toHaveBeenCalledTimes(1);
      expect(await remainingIds()).toEqual(['p', 'd']);
    });
  });
});

// ─── runTripAction ───────────────────────────────────────────────────────────

describe('runTripAction', () => {
  function harness() {
    return {
      enqueue: jest.fn<OfflineTripQueue['enqueue']>(async () => {}),
      setActionError: jest.fn<(message: string | null) => void>(),
      onSuccess: jest.fn<(result: string) => void>(),
      onQueued: jest.fn<() => void>(),
      offline: event('p', TripEventType.PICKUP),
    };
  }

  it('reports success and queues nothing', async () => {
    const h = harness();
    await runTripAction(async () => 'ok', h.enqueue, () => h.offline, h.setActionError, {
      onSuccess: h.onSuccess,
      onQueued: h.onQueued,
    });

    expect(h.onSuccess).toHaveBeenCalledWith('ok');
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.onQueued).not.toHaveBeenCalled();
    expect(h.setActionError.mock.calls).toEqual([[null]]);
  });

  it('queues the offline action on a network error instead of surfacing it', async () => {
    const h = harness();
    await runTripAction(
      async (): Promise<string> => {
        throw networkError();
      },
      h.enqueue,
      () => h.offline,
      h.setActionError,
      { onSuccess: h.onSuccess, onQueued: h.onQueued },
    );

    expect(h.enqueue).toHaveBeenCalledWith(h.offline);
    expect(h.onQueued).toHaveBeenCalledTimes(1);
    expect(h.onSuccess).not.toHaveBeenCalled();
    expect(h.setActionError.mock.calls).toEqual([[null]]);
  });

  it('surfaces the backend message for a rejected action and queues nothing', async () => {
    const h = harness();
    await runTripAction(
      async (): Promise<string> => {
        throw httpError(400, 'This trip is not in progress');
      },
      h.enqueue,
      () => h.offline,
      h.setActionError,
      { onSuccess: h.onSuccess, onQueued: h.onQueued },
    );

    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.onQueued).not.toHaveBeenCalled();
    expect(h.setActionError.mock.calls).toEqual([[null], ['This trip is not in progress']]);
  });
});
