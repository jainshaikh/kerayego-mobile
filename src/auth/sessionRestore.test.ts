import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from '@jest/globals';

import { sessionRestoreFailureAction, type SessionRestoreFailureAction } from './sessionRestore';

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

// An app start without a connection must not sign the person out: the stored
// refresh token is kept and the restore tried again once the server answers.
describe('restoring the stored session on app start, when it fails', () => {
  it.each<[string, unknown, SessionRestoreFailureAction]>([
    ['offline / timeout (no response)', new AxiosError('Network Error', AxiosError.ERR_NETWORK), 'retry'],
    ['500', httpError(500), 'retry'],
    ['503', httpError(503), 'retry'],
    ['429', httpError(429), 'retry'],
    ['an unmapped status (408)', httpError(408), 'retry'],
    ['a non-HTTP error (e.g. the keychain not readable yet)', new Error('keychain locked'), 'retry'],
    ['401 (refresh refused — the session is already expired)', httpError(401), 'signOut'],
    ['403 (suspended)', httpError(403), 'signOut'],
    ['404', httpError(404), 'signOut'],
    ['400', httpError(400), 'signOut'],
  ])('%s → %s', (_label, error, expected) => {
    expect(sessionRestoreFailureAction(error)).toBe(expected);
  });
});
