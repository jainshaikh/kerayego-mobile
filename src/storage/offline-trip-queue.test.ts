import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from '@jest/globals';

import { TripEventType } from '../types/enums';
import {
  enqueueTripAction,
  getQueuedActionsForTrip,
  removeQueuedAction,
  type QueuedTripAction,
} from './offline-trip-queue';

// AsyncStorage is the in-memory mock registered in jest.setup.ts.

const QUEUED_AT = '2026-10-08T09:00:00.000Z';

function startAction(id: string, tripId: string): QueuedTripAction {
  return { id, kind: 'start', tripId, queuedAt: QUEUED_AT };
}

function pickupAction(id: string, tripId: string): QueuedTripAction {
  return {
    id,
    kind: 'event',
    tripId,
    queuedAt: QUEUED_AT,
    payload: { id, tripInquiryId: 'inq-1', type: TripEventType.PICKUP, occurredAt: QUEUED_AT },
  };
}

const ids = (actions: QueuedTripAction[]) => actions.map((action) => action.id);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('offline trip queue storage', () => {
  it('reads an empty queue when nothing is stored', async () => {
    expect(await getQueuedActionsForTrip('trip-a')).toEqual([]);
  });

  it('round-trips an action unchanged', async () => {
    const action = pickupAction('e1', 'trip-a');
    await enqueueTripAction(action);
    expect(await getQueuedActionsForTrip('trip-a')).toEqual([action]);
  });

  it('keeps insertion (FIFO) order and filters by trip', async () => {
    await enqueueTripAction(startAction('a1', 'trip-a'));
    await enqueueTripAction(pickupAction('b1', 'trip-b'));
    await enqueueTripAction(pickupAction('a2', 'trip-a'));
    await enqueueTripAction(pickupAction('a3', 'trip-a'));

    expect(ids(await getQueuedActionsForTrip('trip-a'))).toEqual(['a1', 'a2', 'a3']);
    expect(ids(await getQueuedActionsForTrip('trip-b'))).toEqual(['b1']);
    expect(await getQueuedActionsForTrip('trip-c')).toEqual([]);
  });

  it('removes only the given id and keeps the rest in order', async () => {
    await enqueueTripAction(startAction('a1', 'trip-a'));
    await enqueueTripAction(pickupAction('b1', 'trip-b'));
    await enqueueTripAction(pickupAction('a2', 'trip-a'));

    await removeQueuedAction('a1');

    expect(ids(await getQueuedActionsForTrip('trip-a'))).toEqual(['a2']);
    expect(ids(await getQueuedActionsForTrip('trip-b'))).toEqual(['b1']);
  });

  it('treats removing an id that is already gone as a no-op', async () => {
    await enqueueTripAction(startAction('a1', 'trip-a'));
    await removeQueuedAction('missing');
    await removeQueuedAction('a1');
    await removeQueuedAction('a1');
    expect(await getQueuedActionsForTrip('trip-a')).toEqual([]);
  });

  it.each([
    ['corrupt JSON', '{not json'],
    ['a non-array value', '{"id":"a1"}'],
  ])('reads %s as an empty queue', async (_label, raw) => {
    // Find the storage key without hardcoding it, then corrupt it.
    await enqueueTripAction(startAction('a1', 'trip-a'));
    const [key] = await AsyncStorage.getAllKeys();
    await AsyncStorage.setItem(key, raw);

    expect(await getQueuedActionsForTrip('trip-a')).toEqual([]);
  });

  // Known bug: enqueue/remove each read-modify-write the one storage key with
  // no lock, so whichever write lands last wins — here the enqueue's stale
  // read resurrects the action the remove just deleted (the other
  // interleaving drops the new action instead). Flip to `it` once queue
  // writes are serialized.
  it.failing('applies a concurrent remove and enqueue without a lost update', async () => {
    await enqueueTripAction(startAction('a1', 'trip-a'));

    await Promise.all([removeQueuedAction('a1'), enqueueTripAction(pickupAction('a2', 'trip-a'))]);

    expect(ids(await getQueuedActionsForTrip('trip-a'))).toEqual(['a2']);
  });
});
