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
