import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  clearActiveDriverTrip,
  parseActiveDriverTrip,
  readActiveDriverTrip,
  writeActiveDriverTrip,
  type ActiveDriverTrip,
} from './active-driver-trip';

// AsyncStorage is the in-memory mock registered in jest.setup.ts.
const KEY = 'liveRide.activeDriverTrip';
const TRIP: ActiveDriverTrip = { tripId: 'trip-a', userId: 'user-ali', startedAt: 1_791_453_600_000 };

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('active driver trip store', () => {
  it('reads null when nothing is stored', async () => {
    await expect(readActiveDriverTrip()).resolves.toBeNull();
  });

  it('round-trips a written trip', async () => {
    await writeActiveDriverTrip(TRIP);
    await expect(readActiveDriverTrip()).resolves.toEqual(TRIP);
  });

  it('stores a versioned record under its own key', async () => {
    await writeActiveDriverTrip(TRIP);
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) as string)).toEqual({ v: 1, ...TRIP });
  });

  it('a second write replaces the first (one trip at a time)', async () => {
    await writeActiveDriverTrip(TRIP);
    const next = { tripId: 'trip-b', userId: 'user-ali', startedAt: TRIP.startedAt + 1 };
    await writeActiveDriverTrip(next);
    await expect(readActiveDriverTrip()).resolves.toEqual(next);
  });

  it('clear removes it, and clearing nothing is a no-op', async () => {
    await writeActiveDriverTrip(TRIP);
    await clearActiveDriverTrip();
    await expect(readActiveDriverTrip()).resolves.toBeNull();
    await expect(clearActiveDriverTrip()).resolves.toBeUndefined();
  });

  it('reads a corrupt stored value as absent', async () => {
    await AsyncStorage.setItem(KEY, '{not json');
    await expect(readActiveDriverTrip()).resolves.toBeNull();
  });
});

describe('parseActiveDriverTrip', () => {
  const valid = { v: 1, ...TRIP };

  it('accepts the current shape and drops the version tag', () => {
    expect(parseActiveDriverTrip(JSON.stringify(valid))).toEqual(TRIP);
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['invalid JSON', '{'],
    ['a JSON array', '[]'],
    ['a JSON string', '"trip-a"'],
    ['JSON null', 'null'],
    ['no version tag', JSON.stringify(TRIP)],
    ['another version', JSON.stringify({ ...valid, v: 2 })],
    ['a missing tripId', JSON.stringify({ ...valid, tripId: undefined })],
    ['an empty tripId', JSON.stringify({ ...valid, tripId: '' })],
    ['a numeric userId', JSON.stringify({ ...valid, userId: 42 })],
    ['a missing userId', JSON.stringify({ ...valid, userId: undefined })],
    ['a string startedAt', JSON.stringify({ ...valid, startedAt: '2026-10-09T10:00:00Z' })],
    ['a missing startedAt', JSON.stringify({ ...valid, startedAt: undefined })],
  ])('reads %s as absent', (_label, raw) => {
    expect(parseActiveDriverTrip(raw)).toBeNull();
  });
});
