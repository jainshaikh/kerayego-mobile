import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from '@jest/globals';

import { isRetryableErrorKind, normalizeApiError, type ApiErrorKind } from './errors';

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_RESPONSE, config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: undefined,
  });
}

// The offline trip queue's replay table: 'retry' keeps an action queued for
// a later attempt, 'drop' discards it as the server's final answer.
describe('error classification for retrying a request unchanged', () => {
  it.each<[string, ApiErrorKind, boolean, unknown]>([
    ['no response (offline, timeout)', 'network', true, new AxiosError('Network Error', AxiosError.ERR_NETWORK)],
    ['500', 'server', true, httpError(500)],
    ['502', 'server', true, httpError(502)],
    ['503', 'server', true, httpError(503)],
    ['429', 'rate_limited', true, httpError(429)],
    ['401', 'unauthorized', true, httpError(401)],
    ['408', 'unknown', true, httpError(408)],
    ['a non-HTTP error', 'unknown', true, new Error('boom')],
    ['400', 'validation', false, httpError(400)],
    ['422', 'validation', false, httpError(422)],
    ['403', 'forbidden', false, httpError(403)],
    ['404', 'not_found', false, httpError(404)],
    ['409', 'conflict', false, httpError(409)],
  ])('%s → kind %s, retryable: %s', (_label, kind, retryable, error) => {
    const normalized = normalizeApiError(error);
    expect(normalized.kind).toBe(kind);
    expect(isRetryableErrorKind(normalized.kind)).toBe(retryable);
  });
});

function httpErrorWithBody(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

describe('the backend error code', () => {
  it('passes body.error.code through with the backend message', () => {
    const message =
      'Your account is being checked by KerayeGo. You can browse, but booking, posting trips and driving are paused until the check is done — usually within a day.';
    const normalized = normalizeApiError(
      httpErrorWithBody(403, { success: false, statusCode: 403, error: { code: 'IDENTITY_ON_HOLD', message } }),
    );
    expect(normalized).toMatchObject({ kind: 'forbidden', statusCode: 403, code: 'IDENTITY_ON_HOLD', message });
  });

  // Sign-in and sign-up (A11, A21, A23): the screens show these as sent.
  it.each([
    [401, 'CODE_INVALID', 'unauthorized', 'That code is wrong or has expired. Ask for a new one.'],
    [
      409,
      'PHONE_TAKEN',
      'conflict',
      "This mobile number is already used by another KerayeGo account. If it's yours, contact KerayeGo support.",
    ],
    [409, 'CONFLICT', 'conflict', 'An account with this email already exists'],
    [400, 'BAD_REQUEST', 'validation', 'Enter a valid mobile number, e.g. 03001234567 or +923001234567'],
  ])('keeps the server message for a %i %s', (status, code, kind, message) => {
    const normalized = normalizeApiError(
      httpErrorWithBody(status, { success: false, statusCode: status, error: { code, message } }),
    );
    expect(normalized).toMatchObject({ kind, statusCode: status, code, message });
  });

  it('has no code when the response carries none', () => {
    expect(normalizeApiError(httpError(403)).code).toBeUndefined();
    expect(normalizeApiError(new AxiosError('Network Error', AxiosError.ERR_NETWORK)).code).toBeUndefined();
  });
});

describe('retryAfterSeconds', () => {
  function tooSoon(data: unknown, headers: Record<string, string> = {}): AxiosError {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    return new AxiosError('Request failed with status code 429', AxiosError.ERR_BAD_REQUEST, config, undefined, {
      status: 429,
      statusText: '',
      headers,
      config,
      data,
    });
  }

  it('reads body.error.retryAfterSeconds (CODE_RESEND_TOO_SOON)', () => {
    const normalized = normalizeApiError(
      tooSoon({ success: false, statusCode: 429, error: { code: 'CODE_RESEND_TOO_SOON', message: 'x', retryAfterSeconds: 42 } }),
    );
    expect(normalized).toMatchObject({ kind: 'rate_limited', code: 'CODE_RESEND_TOO_SOON', retryAfterSeconds: 42 });
  });

  it('falls back to a top-level retryAfterSeconds, then the Retry-After header', () => {
    expect(normalizeApiError(tooSoon({ retryAfterSeconds: 12.2, error: { code: 'X', message: 'x' } })).retryAfterSeconds).toBe(13);
    expect(normalizeApiError(tooSoon({ error: { code: 'X', message: 'x' } }, { 'retry-after': '30' })).retryAfterSeconds).toBe(30);
  });

  it('is absent when nothing says', () => {
    expect(normalizeApiError(tooSoon({ error: { code: 'CODE_LIMIT_REACHED', message: 'x' } }))).not.toHaveProperty(
      'retryAfterSeconds',
    );
  });
});

// Since 2026-11-11 a coded error can carry a details object of its own
// (ROUTE_DOES_NOT_FIT's suggestion) — it must reach the screen, and must not
// pass for a validation field list.
describe('error details', () => {
  it('keeps a coded error’s details object, without treating it as field errors', () => {
    const details = {
      suggestion: { durationType: 'HOURS_12', durationQuantity: 1 },
      distanceKm: 330,
      drivingMinutes: 330,
      timeNeededMinutes: 430,
    };
    const message = 'This trip needs about 7 h 10 m (330 km). Choose 12 hours.';
    const normalized = normalizeApiError(
      httpErrorWithBody(400, { success: false, statusCode: 400, error: { code: 'ROUTE_DOES_NOT_FIT', message, details } }),
    );
    expect(normalized).toMatchObject({ kind: 'validation', code: 'ROUTE_DOES_NOT_FIT', message, details });
    expect(normalized.fieldErrors).toBeUndefined();
  });

  it('keeps a validation field list as fieldErrors and joins its messages', () => {
    const fields = [
      { field: 'name', message: 'Name is required' },
      { field: 'email', message: 'Enter a valid email' },
    ];
    const normalized = normalizeApiError(
      httpErrorWithBody(400, { success: false, statusCode: 400, error: { code: 'BAD_REQUEST', message: 'x', details: fields } }),
    );
    expect(normalized.fieldErrors).toEqual(fields);
    expect(normalized.message).toBe('Name is required\nEnter a valid email');
    expect(normalized).not.toHaveProperty('details');
  });
});
