import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from '@jest/globals';

import type { ActiveCustomerShare } from '../../../storage/active-customer-share';
import type { LocationShareTarget, MyLocationSharing } from '../../../types/api.types';
import {
  CUSTOMER_LOCATION_BATCH_MAX,
  CUSTOMER_LOCATION_DISTANCE_M,
  CUSTOMER_LOCATION_INTERVAL_MS,
  LOCATION_SHARING_POLL_MS,
  NEXT_OPENS_AT_MAX_DELAY_MS,
  NEXT_OPENS_AT_MIN_DELAY_MS,
  NEXT_OPENS_AT_SLACK_MS,
  SERVER_STOP_RETRY_AFTER_MS,
  classifyCustomerLocationPostError,
  decideCustomerTaskRun,
  findShareTarget,
  isCustomerServerStopReason,
  isServerStopStillBlocking,
  nextOpensAtDelayMs,
  pickShareTarget,
  planCustomerReconcile,
  sameShareTarget,
  shareTargetDisplayLabel,
  shareTargetKey,
} from './customerLocationRules';

// The backend contract's numbers (live-location contract, 2026-10-29),
// hand-copied — there is no shared package.
const BACKEND_CUSTOMER_LOCATION_BATCH_MAX = 30;
const BACKEND_CUSTOMER_LOCATION_REQUESTS_PER_MINUTE = 20;

const T0 = Date.parse('2026-10-29T09:00:00.000Z');
const USER = 'user-sara';

function target(overrides: Partial<LocationShareTarget> = {}): LocationShareTarget {
  return {
    kind: 'TRIP_INQUIRY',
    id: 'inq-a',
    paused: false,
    pickupAt: '2026-10-29T09:30:00.000Z',
    label: 'Lahore → Islamabad',
    driverName: 'Ali',
    ...overrides,
  };
}

const INQ = target();
const BOOKING = target({ kind: 'BOOKING', id: 'bk-1', label: '2023 Toyota Corolla', driverName: null });

function share(overrides: Partial<ActiveCustomerShare> = {}): ActiveCustomerShare {
  return { kind: 'TRIP_INQUIRY', id: 'inq-a', userId: USER, startedAt: T0, ...overrides };
}

function sharing(targets: LocationShareTarget[], nextOpensAt: string | null = null): MyLocationSharing {
  return { targets, nextOpensAt };
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

const notBlocked = () => false;

describe('constants', () => {
  it('sends about every 10 s, with no distance filter (a waiting customer stands still)', () => {
    expect(CUSTOMER_LOCATION_INTERVAL_MS).toBe(10_000);
    expect(CUSTOMER_LOCATION_DISTANCE_M).toBe(0);
  });

  it('keeps at most 20 unsent fixes — within what one POST accepts', () => {
    expect(CUSTOMER_LOCATION_BATCH_MAX).toBe(20);
    expect(CUSTOMER_LOCATION_BATCH_MAX).toBeLessThanOrEqual(BACKEND_CUSTOMER_LOCATION_BATCH_MAX);
  });

  it('stays far under the backend throttle with the shared 8 s POST spacing', () => {
    // LOCATION_POST_MIN_INTERVAL_MS (8 s) from backgroundLocationRules.
    expect(60_000 / 8_000).toBeLessThan(BACKEND_CUSTOMER_LOCATION_REQUESTS_PER_MINUTE);
  });

  it('polls the windows every 60 s', () => {
    expect(LOCATION_SHARING_POLL_MS).toBe(60_000);
  });
});

describe('targets', () => {
  it('keys and compares by kind and id', () => {
    expect(shareTargetKey(INQ)).toBe('TRIP_INQUIRY:inq-a');
    expect(sameShareTarget(INQ, { kind: 'TRIP_INQUIRY', id: 'inq-a' })).toBe(true);
    expect(sameShareTarget(INQ, { kind: 'BOOKING', id: 'inq-a' })).toBe(false);
    expect(sameShareTarget(INQ, null)).toBe(false);
  });

  it('title-cases a carpool label (cities as stored), leaves a vehicle title as is', () => {
    expect(shareTargetDisplayLabel({ kind: 'TRIP_INQUIRY', label: 'lahore → islamabad' })).toBe('Lahore → Islamabad');
    expect(shareTargetDisplayLabel({ kind: 'BOOKING', label: '2023 Toyota Corolla GLi' })).toBe('2023 Toyota Corolla GLi');
  });

  it('finds a listed window', () => {
    expect(findShareTarget(sharing([INQ, BOOKING]), { kind: 'BOOKING', id: 'bk-1' })).toBe(BOOKING);
    expect(findShareTarget(sharing([INQ]), { kind: 'BOOKING', id: 'bk-1' })).toBeNull();
    expect(findShareTarget(undefined, INQ)).toBeNull();
  });
});

describe('decideCustomerTaskRun', () => {
  const base = { appInForeground: false, share: share(), sessionUserId: USER, driverSharing: false };

  it('sends in the background and in the foreground alike', () => {
    expect(decideCustomerTaskRun(base)).toEqual({ kind: 'send', share: share() });
    expect(decideCustomerTaskRun({ ...base, appInForeground: true })).toEqual({ kind: 'send', share: share() });
  });

  it('stops a registration with nothing recorded', () => {
    expect(decideCustomerTaskRun({ ...base, share: null })).toEqual({ kind: 'stop', reason: 'no_active_target' });
  });

  it('with no session: waits in the foreground (it may be restoring), stops in the background', () => {
    expect(decideCustomerTaskRun({ ...base, sessionUserId: null, appInForeground: true })).toEqual({ kind: 'skip' });
    expect(decideCustomerTaskRun({ ...base, sessionUserId: null })).toEqual({ kind: 'stop', reason: 'no_session' });
  });

  it('stops for another account, and while the driver task shares', () => {
    expect(decideCustomerTaskRun({ ...base, sessionUserId: 'user-ali' })).toEqual({ kind: 'stop', reason: 'other_user' });
    expect(decideCustomerTaskRun({ ...base, driverSharing: true })).toEqual({ kind: 'stop', reason: 'driver_sharing' });
  });
});

describe('classifyCustomerLocationPostError', () => {
  it.each([
    [404, 'ERR', 'target_not_found'],
    [403, 'ERR', 'target_forbidden'],
    [409, 'LOCATION_SHARING_CLOSED', 'sharing_closed'],
    [409, 'LOCATION_SHARING_PAUSED', 'sharing_paused'],
    [409, 'SOMETHING_ELSE', 'sharing_closed'],
    [401, 'ERR', 'session_rejected'],
  ])('%i %s stops sharing (%s) — a server verdict', (status, code, reason) => {
    expect(classifyCustomerLocationPostError(httpError(status, code))).toEqual({ kind: 'stop', reason });
    expect(isCustomerServerStopReason(reason as never)).toBe(true);
  });

  it('429 backs off, 400 drops the batch, 5xx and no network retry', () => {
    expect(classifyCustomerLocationPostError(httpError(429))).toEqual({ kind: 'rate_limited' });
    expect(classifyCustomerLocationPostError(httpError(400))).toEqual({ kind: 'drop_batch' });
    expect(classifyCustomerLocationPostError(httpError(503))).toEqual({ kind: 'retry' });
    expect(classifyCustomerLocationPostError(new AxiosError('Network Error', AxiosError.ERR_NETWORK))).toEqual({
      kind: 'retry',
    });
    expect(classifyCustomerLocationPostError(new Error('boom'))).toEqual({ kind: 'retry' });
  });

  it('local stops are not server verdicts', () => {
    for (const reason of ['paused', 'signed_out', 'other_user', 'window_closed', 'target_changed', 'driver_sharing'] as const) {
      expect(isCustomerServerStopReason(reason)).toBe(false);
    }
  });
});

describe('isServerStopStillBlocking', () => {
  it('blocks for SERVER_STOP_RETRY_AFTER_MS after the stop', () => {
    expect(isServerStopStillBlocking(undefined, T0)).toBe(false);
    expect(isServerStopStillBlocking(T0, T0)).toBe(true);
    expect(isServerStopStillBlocking(T0, T0 + SERVER_STOP_RETRY_AFTER_MS - 1)).toBe(true);
    expect(isServerStopStillBlocking(T0, T0 + SERVER_STOP_RETRY_AFTER_MS)).toBe(false);
  });

  it('never blocks forever when the clock went backwards', () => {
    expect(isServerStopStillBlocking(T0, T0 - 1)).toBe(false);
  });
});

describe('pickShareTarget', () => {
  it('picks the first open, non-paused window', () => {
    expect(pickShareTarget([target({ paused: true }), BOOKING], null, notBlocked)).toBe(BOOKING);
    expect(pickShareTarget([INQ, BOOKING], null, notBlocked)).toBe(INQ);
  });

  it('keeps the window already being shared (one at a time, no switching)', () => {
    expect(pickShareTarget([INQ, BOOKING], { kind: 'BOOKING', id: 'bk-1' }, notBlocked)).toBe(BOOKING);
  });

  it('skips blocked windows, and finds nothing when all are paused or blocked', () => {
    expect(pickShareTarget([INQ, BOOKING], null, (t) => t.kind === 'TRIP_INQUIRY')).toBe(BOOKING);
    expect(pickShareTarget([target({ paused: true })], null, notBlocked)).toBeNull();
    expect(pickShareTarget([], null, notBlocked)).toBeNull();
  });
});

describe('planCustomerReconcile', () => {
  const base = { share: null, userId: USER, sharing: sharing([INQ]), isBlocked: notBlocked, driverSharing: false };

  it('decides nothing while the session is being restored', () => {
    expect(planCustomerReconcile({ ...base, share: share(), userId: undefined })).toEqual({ stop: null, start: null });
  });

  it('starts the first open window', () => {
    expect(planCustomerReconcile(base)).toEqual({ stop: null, start: INQ });
  });

  it('keeps (re-confirms) the window being shared', () => {
    expect(planCustomerReconcile({ ...base, share: share() })).toEqual({ stop: null, start: INQ });
  });

  it('stops once signed out', () => {
    expect(planCustomerReconcile({ ...base, share: share(), userId: null })).toEqual({ stop: 'signed_out', start: null });
    expect(planCustomerReconcile({ ...base, userId: null })).toEqual({ stop: null, start: null });
  });

  it("stops someone else's share, then starts the new account's window", () => {
    expect(planCustomerReconcile({ ...base, share: share({ userId: 'user-ali' }) })).toEqual({
      stop: 'other_user',
      start: INQ,
    });
  });

  it('stops when the window is no longer listed (closed)', () => {
    expect(planCustomerReconcile({ ...base, share: share(), sharing: sharing([]) })).toEqual({
      stop: 'window_closed',
      start: null,
    });
  });

  it('stops when the window was paused (here or on another device)', () => {
    expect(planCustomerReconcile({ ...base, share: share(), sharing: sharing([target({ paused: true })]) })).toEqual({
      stop: 'paused',
      start: null,
    });
  });

  it('switches when the shared window is closed but another is open', () => {
    expect(planCustomerReconcile({ ...base, share: share(), sharing: sharing([BOOKING]) })).toEqual({
      stop: 'window_closed',
      start: BOOKING,
    });
  });

  it('moves off a window the server refused (blocked) to the next one', () => {
    expect(
      planCustomerReconcile({
        ...base,
        share: share(),
        sharing: sharing([INQ, BOOKING]),
        isBlocked: (t) => t.id === INQ.id,
      }),
    ).toEqual({ stop: 'target_changed', start: BOOKING });
  });

  it('never runs alongside the driver task', () => {
    expect(planCustomerReconcile({ ...base, driverSharing: true })).toEqual({ stop: null, start: null });
    expect(planCustomerReconcile({ ...base, share: share(), driverSharing: true })).toEqual({
      stop: 'driver_sharing',
      start: null,
    });
  });

  it('waits for the first answer before starting or closing anything', () => {
    expect(planCustomerReconcile({ ...base, share: share(), sharing: undefined })).toEqual({ stop: null, start: null });
  });
});

describe('nextOpensAtDelayMs', () => {
  it('asks again just after the window opens', () => {
    expect(nextOpensAtDelayMs(new Date(T0 + 60_000).toISOString(), T0)).toBe(60_000 + NEXT_OPENS_AT_SLACK_MS);
  });

  it('a time already past asks again almost at once', () => {
    expect(nextOpensAtDelayMs(new Date(T0 - 60_000).toISOString(), T0)).toBe(NEXT_OPENS_AT_MIN_DELAY_MS);
  });

  it('leaves no time, a bad time, or one too far out to the poll', () => {
    expect(nextOpensAtDelayMs(null, T0)).toBeNull();
    expect(nextOpensAtDelayMs('not a date', T0)).toBeNull();
    expect(nextOpensAtDelayMs(new Date(T0 + NEXT_OPENS_AT_MAX_DELAY_MS).toISOString(), T0)).toBeNull();
  });
});
