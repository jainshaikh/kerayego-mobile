import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Location from 'expo-location';
import { requireOptionalNativeModule } from 'expo';

import { locationSharingApi } from '../../../api/location-sharing.api';
import type { LocationShareTarget, MyLocationSharing } from '../../../types/api.types';
import { readActiveCustomerShare, writeActiveCustomerShare } from '../../../storage/active-customer-share';
import { clearActiveDriverTrip, writeActiveDriverTrip } from '../../../storage/active-driver-trip';
import { LOCATION_POST_MIN_INTERVAL_MS, LOCATION_RATE_LIMIT_BACKOFF_MS } from './backgroundLocationRules';
import {
  DRIVER_LOCATION_TASK,
  ensureDriverLocationSharing,
  setDriverLocationSessionUser,
  stopDriverLocationSharing,
} from './driverLocationSharing';
import { SERVER_STOP_RETRY_AFTER_MS, type CustomerLocationStopReason } from './customerLocationRules';
import {
  CUSTOMER_LOCATION_TASK,
  clearCustomerTargetBlock,
  ensureCustomerLocationSharing,
  getCustomerLocationStatus,
  getCustomerSharingRetryCount,
  handleCustomerLocationTask,
  isCustomerTargetBlocked,
  reconcileCustomerLocationSharing,
  reportCustomerLocationPermissionMissing,
  requestCustomerSharingRetry,
  setCustomerLocationSessionUser,
  stopCustomerLocationSharing,
  stopCustomerLocationSharingFor,
} from './customerLocationSharing';

// Only the endpoint the task posts to (and the driver's, imported through
// driverLocationSharing.ts) — keeps axios/SecureStore (api/client.ts) out.
jest.mock('../../../api/location-sharing.api', () => ({
  locationSharingApi: { postLocations: jest.fn() },
}));
jest.mock('../../../api/trips.api', () => ({
  tripsApi: { recordDriverLocations: jest.fn() },
}));

// The native side, faked: one registration flag per task.
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4 },
  ActivityType: { Other: 1, AutomotiveNavigation: 2 },
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
}));

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

const api = jest.mocked(locationSharingApi);
const startUpdates = jest.mocked(Location.startLocationUpdatesAsync);
const stopUpdates = jest.mocked(Location.stopLocationUpdatesAsync);
const hasStarted = jest.mocked(Location.hasStartedLocationUpdatesAsync);
const nativeModule = jest.mocked(requireOptionalNativeModule);

const T0 = Date.parse('2026-10-29T09:00:00.000Z');
const USER = 'user-sara';
const OTHER_USER = 'user-ali';

const INQ: LocationShareTarget = {
  kind: 'TRIP_INQUIRY',
  id: 'inq-a',
  paused: false,
  pickupAt: '2026-10-29T09:30:00.000Z',
  label: 'Lahore → Islamabad',
  driverName: 'Ali',
};
const BOOKING: LocationShareTarget = { ...INQ, kind: 'BOOKING', id: 'bk-1', label: 'Corolla', driverName: null };
const INQ_REF = { kind: INQ.kind, id: INQ.id };
const BOOKING_REF = { kind: BOOKING.kind, id: BOOKING.id };

const registered = new Set<string>();

function setAppState(state: AppStateStatus): void {
  Object.assign(AppState, { currentState: state });
}

function locationAt(ts: number): Location.LocationObject {
  return {
    coords: {
      latitude: 31.52,
      longitude: 74.35,
      altitude: null,
      accuracy: 6,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: ts,
  };
}

function deliver(...timestamps: number[]): Promise<void> {
  return handleCustomerLocationTask({ data: { locations: timestamps.map((ts) => locationAt(ts)) }, error: null });
}

function sentBatches(): number[][] {
  return api.postLocations.mock.calls.map(([, locations]) => locations.map((fix) => fix.ts));
}

function httpError(status: number, code = 'ERR'): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_RESPONSE, config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, statusCode: status, error: { code, message: 'x' }, timestamp: '', path: '/' },
  });
}

function sharingOf(...targets: LocationShareTarget[]): MyLocationSharing {
  return { targets, nextOpensAt: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function sharing(target = INQ_REF): Promise<void> {
  setCustomerLocationSessionUser(USER);
  await ensureCustomerLocationSharing(target, USER);
  expect(getCustomerLocationStatus()).toEqual({ state: 'running', target });
}

beforeEach(async () => {
  jest.useFakeTimers({ now: T0 });
  await AsyncStorage.clear();
  registered.clear();
  startUpdates.mockReset().mockImplementation(async (task) => {
    registered.add(task);
  });
  stopUpdates.mockReset().mockImplementation(async (task) => {
    registered.delete(task);
  });
  hasStarted.mockReset().mockImplementation(async (task) => registered.has(task));
  nativeModule.mockReset().mockReturnValue({});
  api.postLocations.mockReset().mockResolvedValue({ lastAcceptedAt: null });
  setAppState('background');
});

afterEach(async () => {
  await stopCustomerLocationSharing('signed_out');
  await stopDriverLocationSharing('signed_out');
  setCustomerLocationSessionUser(null);
  setDriverLocationSessionUser(null);
  await clearActiveDriverTrip();
  jest.useRealTimers();
});

describe('starting', () => {
  it('records the target, then registers its own task with the agreed options', async () => {
    await sharing();
    await expect(readActiveCustomerShare()).resolves.toEqual({ ...INQ_REF, userId: USER, startedAt: T0 });
    expect(startUpdates).toHaveBeenCalledTimes(1);
    expect(startUpdates).toHaveBeenCalledWith(CUSTOMER_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 10_000,
      distanceInterval: 0,
      activityType: Location.ActivityType.Other,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Sharing your location',
        notificationBody: 'KerayeGo is sharing your location with your driver until pickup',
        killServiceOnDestroy: true,
      },
    });
    expect(CUSTOMER_LOCATION_TASK).toBe('kerayego.customer-location');
  });

  it('is a no-op while already running for the same target', async () => {
    await sharing();
    await ensureCustomerLocationSharing(INQ_REF, USER);
    expect(startUpdates).toHaveBeenCalledTimes(1);
  });

  it('never starts while the carpool driver task shares for this person', async () => {
    await writeActiveDriverTrip({ tripId: 'trip-a', userId: USER, startedAt: T0 });
    setCustomerLocationSessionUser(USER);
    await ensureCustomerLocationSharing(INQ_REF, USER);
    expect(startUpdates).not.toHaveBeenCalled();
    expect(getCustomerLocationStatus()).toEqual({ state: 'stopped', target: INQ_REF, reason: 'driver_sharing' });
  });

  it('reports a build without background location support as unavailable', async () => {
    nativeModule.mockReturnValue(null);
    setCustomerLocationSessionUser(USER);
    await ensureCustomerLocationSharing(INQ_REF, USER);
    expect(getCustomerLocationStatus()).toEqual({ state: 'failed', target: INQ_REF, reason: 'unavailable' });
    expect(startUpdates).not.toHaveBeenCalled();
  });

  it('reports a failed start and forgets the target', async () => {
    startUpdates.mockRejectedValue(new Error('ForegroundServiceStartNotAllowedException'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setCustomerLocationSessionUser(USER);
    await ensureCustomerLocationSharing(INQ_REF, USER);
    warn.mockRestore();
    expect(getCustomerLocationStatus()).toEqual({ state: 'failed', target: INQ_REF, reason: 'start_failed' });
    await expect(readActiveCustomerShare()).resolves.toBeNull();
  });

  it('never starts for anyone but the signed-in user', async () => {
    setCustomerLocationSessionUser(OTHER_USER);
    await ensureCustomerLocationSharing(INQ_REF, USER);
    expect(startUpdates).not.toHaveBeenCalled();
  });

  it('undoes a start that a logout overtook', async () => {
    setCustomerLocationSessionUser(USER);
    const registering = deferred<void>();
    startUpdates.mockImplementation(async (task) => {
      await registering.promise;
      registered.add(task);
    });
    const start = ensureCustomerLocationSharing(INQ_REF, USER);
    await jest.advanceTimersByTimeAsync(0);
    await stopCustomerLocationSharing('signed_out');
    registering.resolve();
    await start;
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
    await expect(readActiveCustomerShare()).resolves.toBeNull();
    expect(getCustomerLocationStatus()).toMatchObject({ state: 'stopped', reason: 'signed_out' });
  });

  it('a permission problem shows as failed — but never over a running share', async () => {
    reportCustomerLocationPermissionMissing(BOOKING_REF);
    expect(getCustomerLocationStatus()).toEqual({ state: 'failed', target: BOOKING_REF, reason: 'permission' });
    await sharing();
    reportCustomerLocationPermissionMissing(INQ_REF);
    expect(getCustomerLocationStatus()).toEqual({ state: 'running', target: INQ_REF });
  });
});

describe('stopping', () => {
  it('unregisters only its own task and forgets the target', async () => {
    registered.add('kerayego.driver-location');
    await sharing();
    await stopCustomerLocationSharing('paused');
    expect(stopUpdates).toHaveBeenCalledWith(CUSTOMER_LOCATION_TASK);
    expect(stopUpdates).not.toHaveBeenCalledWith('kerayego.driver-location');
    await expect(readActiveCustomerShare()).resolves.toBeNull();
    expect(getCustomerLocationStatus()).toEqual({ state: 'stopped', target: INQ_REF, reason: 'paused' });
  });

  it("Stop on a screen only stops that screen's target", async () => {
    await sharing();
    await stopCustomerLocationSharingFor(BOOKING_REF, 'paused');
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(true);
    await stopCustomerLocationSharingFor(INQ_REF, 'paused');
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
  });

  it('pausing is not a server verdict — Resume can start it again at once', async () => {
    await sharing();
    await stopCustomerLocationSharingFor(INQ_REF, 'paused');
    expect(isCustomerTargetBlocked(INQ_REF)).toBe(false);
    await ensureCustomerLocationSharing(INQ_REF, USER);
    expect(startUpdates).toHaveBeenCalledTimes(2);
  });
});

describe('the task', () => {
  it('posts in the foreground too (no socket path for customers)', async () => {
    await sharing();
    setAppState('active');
    await deliver(T0);
    expect(api.postLocations).toHaveBeenCalledWith(INQ_REF, [{ lat: 31.52, lng: 74.35, accuracyM: 6, ts: T0 }]);
  });

  it('posts a booking to its own target', async () => {
    await sharing(BOOKING_REF);
    await deliver(T0);
    expect(api.postLocations.mock.calls[0][0]).toEqual(BOOKING_REF);
  });

  it('stops a registration with no target recorded', async () => {
    setCustomerLocationSessionUser(USER);
    registered.add(CUSTOMER_LOCATION_TASK);
    await deliver(T0);
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
    expect(api.postLocations).not.toHaveBeenCalled();
  });

  it('with no session: stops in the background, waits in the foreground', async () => {
    await writeActiveCustomerShare({ ...INQ_REF, userId: USER, startedAt: T0 });
    registered.add(CUSTOMER_LOCATION_TASK);
    setAppState('active');
    await deliver(T0);
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(true);
    setAppState('background');
    await deliver(T0 + 1000);
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
    expect(api.postLocations).not.toHaveBeenCalled();
  });

  it('stops when another account is signed in', async () => {
    await sharing();
    setCustomerLocationSessionUser(OTHER_USER);
    await deliver(T0);
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
    expect(getCustomerLocationStatus()).toMatchObject({ state: 'stopped', reason: 'other_user' });
  });

  it('the driver task starting stops this one first — never both registered', async () => {
    await sharing();
    setDriverLocationSessionUser(USER);
    startUpdates.mockImplementation(async (task) => {
      if (task === DRIVER_LOCATION_TASK) expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
      registered.add(task);
    });
    await ensureDriverLocationSharing('trip-a', USER);
    expect(registered.has(DRIVER_LOCATION_TASK)).toBe(true);
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
    expect(getCustomerLocationStatus()).toMatchObject({ state: 'stopped', reason: 'driver_sharing' });
  });

  it('stops once the driver task starts sharing for this person', async () => {
    await sharing();
    await writeActiveDriverTrip({ tripId: 'trip-a', userId: USER, startedAt: T0 });
    await deliver(T0);
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
    expect(api.postLocations).not.toHaveBeenCalled();
    expect(getCustomerLocationStatus()).toMatchObject({ state: 'stopped', reason: 'driver_sharing' });
  });

  it.each<[number, string, CustomerLocationStopReason]>([
    [404, 'ERR', 'target_not_found'],
    [403, 'ERR', 'target_forbidden'],
    [409, 'LOCATION_SHARING_CLOSED', 'sharing_closed'],
    [409, 'LOCATION_SHARING_PAUSED', 'sharing_paused'],
  ])('stops on %i %s and holds that target off for a while', async (status, code, reason) => {
    await sharing();
    api.postLocations.mockRejectedValue(httpError(status, code));
    await deliver(T0);

    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
    await expect(readActiveCustomerShare()).resolves.toBeNull();
    expect(getCustomerLocationStatus()).toEqual({ state: 'stopped', target: INQ_REF, reason });
    expect(isCustomerTargetBlocked(INQ_REF)).toBe(true);

    await ensureCustomerLocationSharing(INQ_REF, USER);
    expect(startUpdates).toHaveBeenCalledTimes(1);

    jest.setSystemTime(T0 + SERVER_STOP_RETRY_AFTER_MS);
    expect(isCustomerTargetBlocked(INQ_REF)).toBe(false);
    await ensureCustomerLocationSharing(INQ_REF, USER);
    expect(startUpdates).toHaveBeenCalledTimes(2);
  });

  it('Resume or Try again lifts a refusal straight away', async () => {
    await sharing();
    api.postLocations.mockRejectedValue(httpError(409, 'LOCATION_SHARING_PAUSED'));
    await deliver(T0);
    clearCustomerTargetBlock(INQ_REF);
    expect(isCustomerTargetBlocked(INQ_REF)).toBe(false);

    await sharing();
    api.postLocations.mockRejectedValue(httpError(404));
    await deliver(T0 + 1);
    const retries = getCustomerSharingRetryCount();
    requestCustomerSharingRetry(INQ_REF);
    expect(getCustomerSharingRetryCount()).toBe(retries + 1);
    expect(isCustomerTargetBlocked(INQ_REF)).toBe(false);
  });

  it('keeps fixes after a network error, capped at 20, and sends them next time', async () => {
    await sharing();
    api.postLocations.mockRejectedValueOnce(new AxiosError('Network Error', AxiosError.ERR_NETWORK));
    await deliver(...Array.from({ length: 25 }, (_, i) => T0 - 25_000 + i * 1000));
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(true);
    expect(sentBatches()[0]).toHaveLength(20);

    jest.setSystemTime(T0 + LOCATION_POST_MIN_INTERVAL_MS);
    await deliver(T0 + LOCATION_POST_MIN_INTERVAL_MS);
    const second = sentBatches()[1];
    expect(second).toHaveLength(20);
    expect(second[second.length - 1]).toBe(T0 + LOCATION_POST_MIN_INTERVAL_MS);
  });

  it('after a 429, sends nothing until the one-minute window has passed', async () => {
    await sharing();
    api.postLocations.mockRejectedValueOnce(httpError(429));
    await deliver(T0);
    jest.setSystemTime(T0 + 30_000);
    await deliver(T0 + 30_000);
    expect(api.postLocations).toHaveBeenCalledTimes(1);
    jest.setSystemTime(T0 + LOCATION_RATE_LIMIT_BACKOFF_MS);
    await deliver(T0 + LOCATION_RATE_LIMIT_BACKOFF_MS);
    expect(sentBatches()).toEqual([[T0], [T0, T0 + 30_000, T0 + LOCATION_RATE_LIMIT_BACKOFF_MS]]);
  });

  it('spaces POSTs at least the minimum interval apart, batching what arrives meanwhile', async () => {
    await sharing();
    const inFlight = deferred<{ lastAcceptedAt: string | null }>();
    api.postLocations.mockReturnValueOnce(inFlight.promise);
    const first = deliver(T0);
    await jest.advanceTimersByTimeAsync(0);
    await deliver(T0 + 1000);
    await deliver(T0 + 2000);
    expect(api.postLocations).toHaveBeenCalledTimes(1);
    inFlight.resolve({ lastAcceptedAt: null });
    await jest.advanceTimersByTimeAsync(LOCATION_POST_MIN_INTERVAL_MS);
    await first;
    expect(sentBatches()).toEqual([[T0], [T0 + 1000, T0 + 2000]]);
  });
});

describe('reconcile', () => {
  it('waits while the session is being restored', async () => {
    await sharing();
    await expect(reconcileCustomerLocationSharing({ userId: undefined, sharing: sharingOf() })).resolves.toBeNull();
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(true);
  });

  it('returns the first open window to start', async () => {
    setCustomerLocationSessionUser(USER);
    await expect(reconcileCustomerLocationSharing({ userId: USER, sharing: sharingOf(INQ, BOOKING) })).resolves.toBe(INQ);
  });

  it('stops once the window is no longer listed', async () => {
    await sharing();
    await expect(reconcileCustomerLocationSharing({ userId: USER, sharing: sharingOf() })).resolves.toBeNull();
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
    expect(getCustomerLocationStatus()).toMatchObject({ state: 'stopped', reason: 'window_closed' });
  });

  it('stops a paused window, and switches to the next open one', async () => {
    await sharing();
    await expect(
      reconcileCustomerLocationSharing({ userId: USER, sharing: sharingOf({ ...INQ, paused: true }, BOOKING) }),
    ).resolves.toBe(BOOKING);
    expect(getCustomerLocationStatus()).toMatchObject({ state: 'stopped', reason: 'paused' });
  });

  it('stops for another account, or nobody', async () => {
    await sharing();
    await reconcileCustomerLocationSharing({ userId: OTHER_USER, sharing: undefined });
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);

    await sharing();
    await reconcileCustomerLocationSharing({ userId: null, sharing: undefined });
    expect(getCustomerLocationStatus()).toMatchObject({ state: 'stopped', reason: 'signed_out' });
  });

  it('stops — and starts nothing — while the driver task shares', async () => {
    await sharing();
    await writeActiveDriverTrip({ tripId: 'trip-a', userId: USER, startedAt: T0 });
    await expect(reconcileCustomerLocationSharing({ userId: USER, sharing: sharingOf(INQ) })).resolves.toBeNull();
    expect(getCustomerLocationStatus()).toMatchObject({ state: 'stopped', reason: 'driver_sharing' });
  });

  it('skips a window the server just refused', async () => {
    await sharing();
    api.postLocations.mockRejectedValue(httpError(409, 'LOCATION_SHARING_CLOSED'));
    await deliver(T0);
    await expect(reconcileCustomerLocationSharing({ userId: USER, sharing: sharingOf(INQ) })).resolves.toBeNull();
  });

  it('stops a registration the OS restored with no target recorded', async () => {
    setCustomerLocationSessionUser(USER);
    registered.add(CUSTOMER_LOCATION_TASK);
    await reconcileCustomerLocationSharing({ userId: USER, sharing: undefined });
    expect(registered.has(CUSTOMER_LOCATION_TASK)).toBe(false);
  });
});
