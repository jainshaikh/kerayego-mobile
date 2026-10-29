import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  clearActiveCustomerShare,
  parseActiveCustomerShare,
  readActiveCustomerShare,
  writeActiveCustomerShare,
  type ActiveCustomerShare,
} from './active-customer-share';

// AsyncStorage is the in-memory mock registered in jest.setup.ts.
const KEY = 'liveRide.activeCustomerShare';
const SHARE: ActiveCustomerShare = { kind: 'TRIP_INQUIRY', id: 'inq-a', userId: 'user-sara', startedAt: 1_791_453_600_000 };

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('active customer share store', () => {
  it('reads null when nothing is stored', async () => {
    await expect(readActiveCustomerShare()).resolves.toBeNull();
  });

  it('round-trips a written share, under its own versioned key', async () => {
    await writeActiveCustomerShare(SHARE);
    await expect(readActiveCustomerShare()).resolves.toEqual(SHARE);
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) as string)).toEqual({ v: 1, ...SHARE });
  });

  it('a second write replaces the first (one window at a time)', async () => {
    await writeActiveCustomerShare(SHARE);
    const next: ActiveCustomerShare = { kind: 'BOOKING', id: 'bk-1', userId: 'user-sara', startedAt: 1 };
    await writeActiveCustomerShare(next);
    await expect(readActiveCustomerShare()).resolves.toEqual(next);
  });

  it('clear removes it', async () => {
    await writeActiveCustomerShare(SHARE);
    await clearActiveCustomerShare();
    await expect(readActiveCustomerShare()).resolves.toBeNull();
  });

  it('is stored apart from the driver trip record', async () => {
    await writeActiveCustomerShare(SHARE);
    expect(await AsyncStorage.getItem('liveRide.activeDriverTrip')).toBeNull();
  });
});

describe('parseActiveCustomerShare', () => {
  const valid = { v: 1, ...SHARE };

  it('accepts both kinds and drops the version tag', () => {
    expect(parseActiveCustomerShare(JSON.stringify(valid))).toEqual(SHARE);
    expect(parseActiveCustomerShare(JSON.stringify({ ...valid, kind: 'BOOKING' }))).toEqual({ ...SHARE, kind: 'BOOKING' });
  });

  it.each([
    ['null', null],
    ['invalid JSON', '{'],
    ['JSON null', 'null'],
    ['no version tag', JSON.stringify(SHARE)],
    ['another version', JSON.stringify({ ...valid, v: 2 })],
    ['an unknown kind', JSON.stringify({ ...valid, kind: 'TRIP' })],
    ['an empty id', JSON.stringify({ ...valid, id: '' })],
    ['a missing userId', JSON.stringify({ ...valid, userId: undefined })],
    ['a string startedAt', JSON.stringify({ ...valid, startedAt: '2026-10-29T10:00:00Z' })],
  ])('reads %s as absent', (_label, raw) => {
    expect(parseActiveCustomerShare(raw)).toBeNull();
  });
});
