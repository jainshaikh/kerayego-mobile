import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Location from 'expo-location';
import { requireOptionalNativeModule } from 'expo';

import { tripsApi } from '../../../api/trips.api';
import { readActiveDriverTrip, writeActiveDriverTrip } from '../../../storage/active-driver-trip';
import {
  ACTIVE_RIDE_TRUST_DELAY_MS,
  LOCATION_POST_MIN_INTERVAL_MS,
  LOCATION_RATE_LIMIT_BACKOFF_MS,
  type DriverLocationStopReason,
} from './backgroundLocationRules';
import {
  DRIVER_LOCATION_TASK,
  ensureDriverLocationSharing,
  getBackgroundLocationStatus,
  handleDriverLocationTask,
  reconcileDriverLocationSharing,
  setDriverLocationSessionUser,
  stopDriverLocationSharing,
  stopDriverLocationSharingForTrip,
  subscribeBackgroundLocationStatus,
  wasStoppedByServer,
} from './driverLocationSharing';

// Only the one endpoint the task posts to — keeps axios/SecureStore
// (api/client.ts) out of the test. AsyncStorage is the in-memory mock from
// jest.setup.ts.
jest.mock('../../../api/trips.api', () => ({
  tripsApi: { recordDriverLocations: jest.fn() },
}));

// The native side, faked: one registration flag for the task.
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  ActivityType: { AutomotiveNavigation: 2 },
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
}));

// Whether the binary has expo-task-manager's native module.
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

const api = jest.mocked(tripsApi);
const startUpdates = jest.mocked(Location.startLocationUpdatesAsync);
const stopUpdates = jest.mocked(Location.stopLocationUpdatesAsync);
const hasStarted = jest.mocked(Location.hasStartedLocationUpdatesAsync);
const nativeModule = jest.mocked(requireOptionalNativeModule);

const T0 = Date.parse('2026-10-09T09:00:00.000Z');
const TRIP = 'trip-a';
const USER = 'user-ali';
const OTHER_USER = 'user-sara';

let registered = false;

function setAppState(state: AppStateStatus): void {
  // The preset's AppState mock is a plain object whose currentState is a
  // jest.fn — replace it with a real value per test.
  Object.assign(AppState, { currentState: state });
}

function locationAt(ts: number, overrides: Partial<Location.LocationObject['coords']> = {}): Location.LocationObject {
  return {
    coords: {
      latitude: 24.86,
      longitude: 67.0,
      altitude: null,
      accuracy: 5,
      altitudeAccuracy: null,
      heading: 180,
      speed: 20,
      ...overrides,
    },
    timestamp: ts,
  };
}

function deliver(...timestamps: number[]): Promise<void> {
  return handleDriverLocationTask({ data: { locations: timestamps.map((ts) => locationAt(ts)) }, error: null });
}

function sentBatches(): number[][] {
  return api.recordDriverLocations.mock.calls.map(([, locations]) => locations.map((fix) => fix.ts));
}

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_RESPONSE, config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, statusCode: status, error: { code: 'ERR', message: 'x' }, timestamp: '', path: '/' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A trip already being shared by the signed-in driver.
async function sharing(): Promise<void> {
  setDriverLocationSessionUser(USER);
  await ensureDriverLocationSharing(TRIP, USER);
  expect(getBackgroundLocationStatus()).toEqual({ state: 'running', tripId: TRIP });
}

beforeEach(async () => {
  jest.useFakeTimers({ now: T0 });
  await AsyncStorage.clear();
  registered = false;
  startUpdates.mockReset().mockImplementation(async () => {
    registered = true;
  });
  stopUpdates.mockReset().mockImplementation(async () => {
    registered = false;
  });
  hasStarted.mockReset().mockImplementation(async () => registered);
  nativeModule.mockReset().mockReturnValue({});
  api.recordDriverLocations.mockReset().mockResolvedValue({ accepted: 1 });
  setAppState('background');
});

afterEach(async () => {
  // Module state lives on between tests: end every session cleanly.
  await stopDriverLocationSharing('signed_out');
  setDriverLocationSessionUser(null);
  jest.useRealTimers();
});

describe('starting', () => {
  it('records the trip, then registers the task with the agreed options', async () => {
    await sharing();

    await expect(readActiveDriverTrip()).resolves.toEqual({ tripId: TRIP, userId: USER, startedAt: T0 });
    expect(startUpdates).toHaveBeenCalledTimes(1);
    expect(startUpdates).toHaveBeenCalledWith(DRIVER_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 10_000,
      distanceInterval: 25,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Trip in progress',
        notificationBody: 'KerayeGo is sharing your location with your riders',
        killServiceOnDestroy: true,
      },
    });
  });

  it('notifies status subscribers', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeBackgroundLocationStatus(listener);
    await sharing();
    unsubscribe();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2); // starting, running
  });

  it('is a no-op while already running for the same trip', async () => {
    await sharing();
    await ensureDriverLocationSharing(TRIP, USER);
    expect(startUpdates).toHaveBeenCalledTimes(1);
  });

  it('re-registers if the OS lost the registration, keeping the original start time', async () => {
    await sharing();
    registered = false;
    jest.setSystemTime(T0 + 60_000);
    await ensureDriverLocationSharing(TRIP, USER);
    expect(startUpdates).toHaveBeenCalledTimes(2);
    await expect(readActiveDriverTrip()).resolves.toEqual({ tripId: TRIP, userId: USER, startedAt: T0 });
  });

  it('reports a build without background location support as unavailable', async () => {
    nativeModule.mockReturnValue(null);
    setDriverLocationSessionUser(USER);
    await ensureDriverLocationSharing(TRIP, USER);
    expect(getBackgroundLocationStatus()).toEqual({ state: 'failed', tripId: TRIP, reason: 'unavailable' });
    expect(startUpdates).not.toHaveBeenCalled();
    await expect(readActiveDriverTrip()).resolves.toBeNull();
  });

  it('reports a failed start and forgets the trip', async () => {
    startUpdates.mockRejectedValue(new Error('ForegroundServiceStartNotAllowedException'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setDriverLocationSessionUser(USER);
    await ensureDriverLocationSharing(TRIP, USER);
    warn.mockRestore();
    expect(getBackgroundLocationStatus()).toEqual({ state: 'failed', tripId: TRIP, reason: 'start_failed' });
    await expect(readActiveDriverTrip()).resolves.toBeNull();
  });

  it('a failed re-start keeps the record of a registration that is still alive', async () => {
    // Restored by the OS at launch; re-registering it is what failed.
    await writeActiveDriverTrip({ tripId: TRIP, userId: USER, startedAt: T0 });
    registered = true;
    startUpdates.mockRejectedValue(new Error('ForegroundServiceStartNotAllowedException'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setDriverLocationSessionUser(USER);
    await ensureDriverLocationSharing(TRIP, USER);
    warn.mockRestore();
    expect(getBackgroundLocationStatus()).toEqual({ state: 'failed', tripId: TRIP, reason: 'start_failed' });
    await expect(readActiveDriverTrip()).resolves.toEqual({ tripId: TRIP, userId: USER, startedAt: T0 });
  });

  it('never starts for anyone but the signed-in user', async () => {
    setDriverLocationSessionUser(OTHER_USER);
    await ensureDriverLocationSharing(TRIP, USER);
    expect(startUpdates).not.toHaveBeenCalled();
  });

  it('undoes a start that a logout overtook', async () => {
    setDriverLocationSessionUser(USER);
    // The native registration completes only after the logout's own stop
    // has looked (and found nothing registered yet).
    const registering = deferred<void>();
    startUpdates.mockImplementation(async () => {
      await registering.promise;
      registered = true;
    });
    const start = ensureDriverLocationSharing(TRIP, USER);
    await jest.advanceTimersByTimeAsync(0);
    await stopDriverLocationSharing('signed_out');
    expect(stopUpdates).not.toHaveBeenCalled();
    registering.resolve();
    await start;

    expect(registered).toBe(false);
    await expect(readActiveDriverTrip()).resolves.toBeNull();
    expect(getBackgroundLocationStatus()).toMatchObject({ state: 'stopped', reason: 'signed_out' });
  });
});

describe('stopping', () => {
  it('unregisters the task and forgets the trip', async () => {
    await sharing();
    await stopDriverLocationSharing('signed_out');
    expect(stopUpdates).toHaveBeenCalledWith(DRIVER_LOCATION_TASK);
    expect(registered).toBe(false);
    await expect(readActiveDriverTrip()).resolves.toBeNull();
    expect(getBackgroundLocationStatus()).toEqual({ state: 'stopped', tripId: TRIP, reason: 'signed_out' });
  });

  it('is safe to repeat, and never calls stop on a task that is not registered', async () => {
    await stopDriverLocationSharing('signed_out');
    await stopDriverLocationSharing('signed_out');
    expect(stopUpdates).not.toHaveBeenCalled();
  });

  it("a trip screen only stops its own trip's sharing", async () => {
    await sharing();
    await stopDriverLocationSharingForTrip('trip-b', 'trip_ended');
    expect(registered).toBe(true);

    await stopDriverLocationSharingForTrip(TRIP, 'trip_ended');
    expect(registered).toBe(false);
    expect(getBackgroundLocationStatus()).toEqual({ state: 'stopped', tripId: TRIP, reason: 'trip_ended' });
  });

  it('a trip screen also stops a recorded trip this run never started (restored after a relaunch)', async () => {
    await writeActiveDriverTrip({ tripId: TRIP, userId: USER, startedAt: T0 });
    registered = true;
    await stopDriverLocationSharingForTrip(TRIP, 'trip_ended');
    expect(registered).toBe(false);
    await expect(readActiveDriverTrip()).resolves.toBeNull();
  });

  it('the trip ending on the device is not a server verdict — it may be shared again', async () => {
    await sharing();
    await stopDriverLocationSharingForTrip(TRIP, 'trip_ended');
    expect(wasStoppedByServer(TRIP)).toBe(false);
  });
});

describe('the task', () => {
  it('sends nothing in the foreground — the watch and the socket do', async () => {
    await sharing();
    setAppState('active');
    await deliver(T0);
    setAppState('inactive');
    await deliver(T0 + 1000);
    expect(api.recordDriverLocations).not.toHaveBeenCalled();
  });

  it('posts background fixes for the recorded trip, sanitized and without tripId', async () => {
    await sharing();
    await handleDriverLocationTask({
      data: { locations: [locationAt(T0 + 1000, { heading: -1, speed: -1 }), locationAt(T0)] },
      error: null,
    });
    expect(api.recordDriverLocations).toHaveBeenCalledWith(TRIP, [
      { lat: 24.86, lng: 67.0, headingDeg: 180, speedKmh: 72, accuracyM: 5, ts: T0 },
      { lat: 24.86, lng: 67.0, accuracyM: 5, ts: T0 + 1000 },
    ]);
  });

  it('ignores a delivery with an error, or with no usable fix', async () => {
    await sharing();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await handleDriverLocationTask({ data: undefined, error: { code: 0, message: 'location unknown' } });
    warn.mockRestore();
    await handleDriverLocationTask({ data: { locations: [locationAt(T0, { latitude: Number.NaN })] }, error: null });
    await handleDriverLocationTask({ data: undefined, error: null });
    expect(api.recordDriverLocations).not.toHaveBeenCalled();
    expect(registered).toBe(true);
  });

  it('stops a registration with no trip recorded', async () => {
    setDriverLocationSessionUser(USER);
    registered = true;
    await deliver(T0);
    expect(registered).toBe(false);
    expect(api.recordDriverLocations).not.toHaveBeenCalled();
  });

  it('stops — without posting — in a runtime with no signed-in session', async () => {
    await writeActiveDriverTrip({ tripId: TRIP, userId: USER, startedAt: T0 });
    registered = true;
    await deliver(T0);
    expect(registered).toBe(false);
    expect(api.recordDriverLocations).not.toHaveBeenCalled();
    await expect(readActiveDriverTrip()).resolves.toBeNull();
  });

  it('stops — without posting — when another account is signed in', async () => {
    await sharing();
    setDriverLocationSessionUser(OTHER_USER);
    await deliver(T0);
    expect(registered).toBe(false);
    expect(api.recordDriverLocations).not.toHaveBeenCalled();
    expect(getBackgroundLocationStatus()).toMatchObject({ state: 'stopped', reason: 'other_user' });
  });

  it.each<[number, DriverLocationStopReason]>([
    [404, 'trip_not_found'],
    [409, 'trip_not_in_progress'],
  ])('stops quietly on %i and never restarts that trip this run', async (status, reason) => {
    await sharing();
    api.recordDriverLocations.mockRejectedValue(httpError(status));
    await deliver(T0);

    expect(registered).toBe(false);
    await expect(readActiveDriverTrip()).resolves.toBeNull();
    expect(getBackgroundLocationStatus()).toEqual({ state: 'stopped', tripId: TRIP, reason });
    expect(wasStoppedByServer(TRIP)).toBe(true);

    await ensureDriverLocationSharing(TRIP, USER);
    expect(startUpdates).toHaveBeenCalledTimes(1);
  });

  it('a new session may share a trip the previous one was refused', async () => {
    await sharing();
    api.recordDriverLocations.mockRejectedValue(httpError(404));
    await deliver(T0);
    setDriverLocationSessionUser(null);
    setDriverLocationSessionUser(USER);
    expect(wasStoppedByServer(TRIP)).toBe(false);
  });

  it('keeps the fixes after a network error and sends them with the next delivery', async () => {
    await sharing();
    api.recordDriverLocations.mockRejectedValueOnce(new AxiosError('Network Error', AxiosError.ERR_NETWORK));
    await deliver(T0);
    expect(registered).toBe(true);

    jest.setSystemTime(T0 + LOCATION_POST_MIN_INTERVAL_MS);
    await deliver(T0 + LOCATION_POST_MIN_INTERVAL_MS);
    expect(sentBatches()).toEqual([[T0], [T0, T0 + LOCATION_POST_MIN_INTERVAL_MS]]);
  });

  it('drops a batch the server refused as invalid, and carries on', async () => {
    await sharing();
    api.recordDriverLocations.mockRejectedValueOnce(httpError(400));
    await deliver(T0);
    jest.setSystemTime(T0 + LOCATION_POST_MIN_INTERVAL_MS);
    await deliver(T0 + LOCATION_POST_MIN_INTERVAL_MS);
    expect(sentBatches()).toEqual([[T0], [T0 + LOCATION_POST_MIN_INTERVAL_MS]]);
    expect(registered).toBe(true);
  });

  it('after a 429, sends nothing until the one-minute window has passed', async () => {
    await sharing();
    api.recordDriverLocations.mockRejectedValueOnce(httpError(429));
    await deliver(T0);

    jest.setSystemTime(T0 + 30_000);
    await deliver(T0 + 30_000);
    expect(api.recordDriverLocations).toHaveBeenCalledTimes(1);

    jest.setSystemTime(T0 + LOCATION_RATE_LIMIT_BACKOFF_MS);
    await deliver(T0 + LOCATION_RATE_LIMIT_BACKOFF_MS);
    expect(sentBatches()).toEqual([[T0], [T0, T0 + 30_000, T0 + LOCATION_RATE_LIMIT_BACKOFF_MS]]);
  });

  it('batches fixes that arrive while a POST is in flight, and sends them after the minimum gap', async () => {
    await sharing();
    const inFlight = deferred<{ accepted: number }>();
    api.recordDriverLocations.mockReturnValueOnce(inFlight.promise);

    const first = deliver(T0);
    await jest.advanceTimersByTimeAsync(0);
    // iOS delivers by distance — up to about one fix a second at speed.
    await deliver(T0 + 1000);
    await deliver(T0 + 2000);
    expect(api.recordDriverLocations).toHaveBeenCalledTimes(1);

    inFlight.resolve({ accepted: 1 });
    await jest.advanceTimersByTimeAsync(LOCATION_POST_MIN_INTERVAL_MS);
    await first;
    expect(sentBatches()).toEqual([[T0], [T0 + 1000, T0 + 2000]]);
  });

  it('throws away fixes still waiting once the app is back in the foreground', async () => {
    await sharing();
    await deliver(T0);
    jest.setSystemTime(T0 + 1000);
    const waiting = deliver(T0 + 1000);
    // Reaches the wait before its POST, then the driver opens the app.
    await jest.advanceTimersByTimeAsync(0);
    setAppState('active');
    await jest.advanceTimersByTimeAsync(LOCATION_POST_MIN_INTERVAL_MS);
    await waiting;
    expect(sentBatches()).toEqual([[T0]]);

    setAppState('background');
    jest.setSystemTime(T0 + 20_000);
    await deliver(T0 + 20_000);
    expect(sentBatches()).toEqual([[T0], [T0 + 20_000]]);
  });

  it('a POST that comes back after logout changes nothing', async () => {
    await sharing();
    const inFlight = deferred<{ accepted: number }>();
    api.recordDriverLocations.mockReturnValueOnce(inFlight.promise);
    const first = deliver(T0);
    await jest.advanceTimersByTimeAsync(0);

    await stopDriverLocationSharing('signed_out');
    inFlight.reject(httpError(404));
    await first;
    // The 404 belonged to the ended session: not recorded as a verdict.
    expect(wasStoppedByServer(TRIP)).toBe(false);
    expect(getBackgroundLocationStatus()).toMatchObject({ state: 'stopped', reason: 'signed_out' });
  });
});

describe('reconcile', () => {
  const trusted = T0 + ACTIVE_RIDE_TRUST_DELAY_MS;

  it('waits while the session is being restored', async () => {
    await sharing();
    await reconcileDriverLocationSharing({ userId: undefined, activeRide: null, activeRideFetchedAt: trusted });
    expect(registered).toBe(true);
  });

  it('stops once nobody is signed in (e.g. a launch that failed to restore the session)', async () => {
    await writeActiveDriverTrip({ tripId: TRIP, userId: USER, startedAt: T0 });
    registered = true;
    await reconcileDriverLocationSharing({ userId: null, activeRide: undefined, activeRideFetchedAt: 0 });
    expect(registered).toBe(false);
    await expect(readActiveDriverTrip()).resolves.toBeNull();
  });

  it('stops for another account', async () => {
    await sharing();
    await reconcileDriverLocationSharing({ userId: OTHER_USER, activeRide: undefined, activeRideFetchedAt: 0 });
    expect(registered).toBe(false);
  });

  it('stops — for good this run — once a trusted active-ride answer has no ride', async () => {
    await sharing();
    await reconcileDriverLocationSharing({ userId: USER, activeRide: null, activeRideFetchedAt: trusted - 1 });
    expect(registered).toBe(true);

    await reconcileDriverLocationSharing({ userId: USER, activeRide: null, activeRideFetchedAt: trusted });
    expect(registered).toBe(false);
    expect(wasStoppedByServer(TRIP)).toBe(true);
  });

  it('keeps sharing while the driver is still on the trip', async () => {
    await sharing();
    await reconcileDriverLocationSharing({
      userId: USER,
      activeRide: { role: 'driver', tripId: TRIP },
      activeRideFetchedAt: trusted,
    });
    expect(registered).toBe(true);
  });

  it('stops a registration the OS restored with no trip recorded', async () => {
    setDriverLocationSessionUser(USER);
    registered = true;
    await reconcileDriverLocationSharing({ userId: USER, activeRide: undefined, activeRideFetchedAt: 0 });
    expect(registered).toBe(false);
  });

  it('does nothing in a build without background location support', async () => {
    nativeModule.mockReturnValue(null);
    await writeActiveDriverTrip({ tripId: TRIP, userId: USER, startedAt: T0 });
    await reconcileDriverLocationSharing({ userId: null, activeRide: undefined, activeRideFetchedAt: 0 });
    await expect(readActiveDriverTrip()).resolves.not.toBeNull();
  });
});
