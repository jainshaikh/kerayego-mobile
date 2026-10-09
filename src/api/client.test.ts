import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { clearAllAuthStorage, getRefreshToken, setRefreshToken } from '../storage/secure-storage';
import apiClient, { getAccessToken, refreshAccessToken, setAccessToken, setOnSessionExpired } from './client';
import { normalizeApiError } from './errors';

// SecureStore stand-in — keeps expo-secure-store out of the test.
jest.mock('../storage/secure-storage', () => ({
  getRefreshToken: jest.fn(),
  setRefreshToken: jest.fn(),
  clearAllAuthStorage: jest.fn(),
}));

const storage = {
  get: jest.mocked(getRefreshToken),
  set: jest.mocked(setRefreshToken),
  clear: jest.mocked(clearAllAuthStorage),
};

let storedRefreshToken: string | null = null;
const sessionExpired = jest.fn();

// ─── Fake transport ──────────────────────────────────────────────────────────
// apiClient's real interceptors run; only the HTTP adapter underneath is
// replaced, so every request lands in `route` instead of on the network.

type Route = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;
let route: Route;
const requests: { url: string; auth: string | null; body: unknown }[] = [];

apiClient.defaults.adapter = (config) => {
  const auth = config.headers?.Authorization;
  requests.push({
    url: config.url ?? '',
    auth: typeof auth === 'string' ? auth : null,
    body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
  });
  return route(config);
};

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown = {}): Promise<AxiosResponse> {
  const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config };
  if (status < 400) return Promise.resolve(response);
  return Promise.reject(
    new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, null, response),
  );
}

function offline(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config));
}

function tokens(accessToken: string, refreshToken: string) {
  return { success: true, data: { accessToken, refreshToken } };
}

// A refresh response the test releases by hand, to hold the flight open.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const refreshCalls = () => requests.filter((r) => r.url === '/auth/refresh');

// Serves /auth/refresh with `onRefresh`; any other URL succeeds only with the
// bearer token `validToken`, else 401.
function api(onRefresh: Route, validToken: string): Route {
  return (config) => {
    if (config.url === '/auth/refresh') return onRefresh(config);
    const ok = config.headers?.Authorization === `Bearer ${validToken}`;
    return reply(config, ok ? 200 : 401, { success: true, data: { url: config.url } });
  };
}

beforeEach(() => {
  requests.length = 0;
  sessionExpired.mockReset();
  storage.get.mockReset().mockImplementation(async () => storedRefreshToken);
  storage.set.mockReset().mockImplementation(async (token: string) => {
    storedRefreshToken = token;
  });
  storage.clear.mockReset().mockImplementation(async () => {
    storedRefreshToken = null;
  });
  storedRefreshToken = 'rt-1';
  // A fresh session (new epoch) per test, like a login.
  setAccessToken('at-1');
  setOnSessionExpired(sessionExpired);
  route = () => Promise.reject(new Error('unexpected request'));
});

// ─── refreshAccessToken ──────────────────────────────────────────────────────

describe('refreshAccessToken (shared single-flight)', () => {
  it('lets concurrent callers share one POST /auth/refresh, so the stored token is presented once', async () => {
    const gate = deferred<void>();
    route = async (config) => {
      await gate.promise;
      return reply(config, 200, tokens('at-2', 'rt-2'));
    };

    const callers = [refreshAccessToken(), refreshAccessToken(), refreshAccessToken()];
    gate.resolve();

    await expect(Promise.all(callers)).resolves.toEqual(['at-2', 'at-2', 'at-2']);
    expect(refreshCalls()).toHaveLength(1);
    expect(refreshCalls()[0].body).toEqual({ refreshToken: 'rt-1' });
    expect(getAccessToken()).toBe('at-2');
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storedRefreshToken).toBe('rt-2');
  });

  it('starts a new refresh, with the rotated token, once the previous one has settled', async () => {
    let n = 1;
    route = (config) => {
      n += 1;
      return reply(config, 200, tokens(`at-${n}`, `rt-${n}`));
    };

    await expect(refreshAccessToken()).resolves.toBe('at-2');
    await expect(refreshAccessToken()).resolves.toBe('at-3');
    expect(refreshCalls().map((r) => r.body)).toEqual([{ refreshToken: 'rt-1' }, { refreshToken: 'rt-2' }]);
  });

  it('expires the session exactly once when the backend rejects the refresh token (401), resolving null for every caller', async () => {
    const gate = deferred<void>();
    route = async (config) => {
      await gate.promise;
      return reply(config, 401, { success: false, error: { message: 'Refresh token has expired' } });
    };

    const callers = [refreshAccessToken(), refreshAccessToken()];
    gate.resolve();

    await expect(Promise.all(callers)).resolves.toEqual([null, null]);
    expect(refreshCalls()).toHaveLength(1);
    expect(sessionExpired).toHaveBeenCalledTimes(1);
    expect(storage.clear).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('treats 403 (suspended account) as a rejected session too', async () => {
    route = (config) => reply(config, 403);
    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(sessionExpired).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['offline', offline],
    ['503', (config: InternalAxiosRequestConfig) => reply(config, 503)],
    ['429', (config: InternalAxiosRequestConfig) => reply(config, 429)],
  ])('rejects on a transient failure (%s) and keeps the session', async (_label, failure) => {
    route = failure;
    await expect(refreshAccessToken()).rejects.toBeInstanceOf(AxiosError);
    expect(sessionExpired).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('at-1');
    expect(storedRefreshToken).toBe('rt-1');
  });

  it('resolves null without expiring anything for a guest (no refresh token, no access token)', async () => {
    storedRefreshToken = null;
    setAccessToken(null);
    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(refreshCalls()).toHaveLength(0);
    expect(sessionExpired).not.toHaveBeenCalled();
  });

  it('expires a live session whose refresh token has gone missing', async () => {
    storedRefreshToken = null;
    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(sessionExpired).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('discards tokens that arrive after a logout instead of reviving the session', async () => {
    const gate = deferred<void>();
    route = async (config) => {
      await gate.promise;
      return reply(config, 200, tokens('at-2', 'rt-2'));
    };

    const inFlight = refreshAccessToken();
    setAccessToken(null); // logout (AuthProvider.clearSession)
    storedRefreshToken = null;
    gate.resolve();

    await expect(inFlight).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(storage.set).not.toHaveBeenCalled();
    expect(storedRefreshToken).toBeNull();
  });

  it("never lets the previous session's late rejection expire the next account's session", async () => {
    const gate = deferred<void>();
    route = async (config) => {
      await gate.promise;
      return reply(config, 401);
    };

    const inFlight = refreshAccessToken();
    setAccessToken('at-next-user'); // another account logs in meanwhile
    gate.resolve();

    await expect(inFlight).resolves.toBeNull();
    expect(sessionExpired).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('at-next-user');
  });

  it("does not hand the next session the previous session's in-flight refresh", async () => {
    const first = deferred<void>();
    route = async (config) => {
      await first.promise;
      return reply(config, 200, tokens('at-old', 'rt-old'));
    };
    const oldFlight = refreshAccessToken();

    setAccessToken('at-next-user');
    storedRefreshToken = 'rt-next';
    route = (config) => reply(config, 200, tokens('at-next-2', 'rt-next-2'));

    await expect(refreshAccessToken()).resolves.toBe('at-next-2');
    first.resolve();
    await expect(oldFlight).resolves.toBeNull();
    expect(getAccessToken()).toBe('at-next-2');
    expect(storedRefreshToken).toBe('rt-next-2');
  });
});

// ─── 401 interceptor ─────────────────────────────────────────────────────────

describe('401 response interceptor', () => {
  it('refreshes once for concurrent 401s and retries each request with the new token', async () => {
    const gate = deferred<void>();
    route = api(async (config) => {
      await gate.promise;
      return reply(config, 200, tokens('at-2', 'rt-2'));
    }, 'at-2');

    const results = Promise.all(['/a', '/b', '/c'].map((url) => apiClient.get(url)));
    gate.resolve();

    const responses = await results;
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshCalls()).toHaveLength(1);
    const retries = requests.filter((r) => r.url !== '/auth/refresh' && r.auth === 'Bearer at-2');
    expect(retries.map((r) => r.url).sort()).toEqual(['/a', '/b', '/c']);
  });

  it('retries a request that went out with an already-replaced token using the current one, without refreshing again', async () => {
    const lateGate = deferred<void>();
    route = async (config) => {
      if (config.url === '/auth/refresh') return reply(config, 200, tokens('at-2', 'rt-2'));
      if (config.url === '/late' && config.headers?.Authorization === 'Bearer at-1') await lateGate.promise;
      return reply(config, config.headers?.Authorization === 'Bearer at-2' ? 200 : 401);
    };

    // Goes out with at-1 and is still in flight when the token is refreshed
    // elsewhere (e.g. by the ride socket's reconnect).
    const late = apiClient.get('/late');
    await expect(refreshAccessToken()).resolves.toBe('at-2');
    lateGate.resolve();

    await expect(late).resolves.toMatchObject({ status: 200 });
    expect(refreshCalls()).toHaveLength(1);
    expect(requests.filter((r) => r.url === '/late').map((r) => r.auth)).toEqual(['Bearer at-1', 'Bearer at-2']);
  });

  it('rejects with the original 401 and does not retry once the session is gone', async () => {
    route = api((config) => reply(config, 401), 'never');

    const error = await apiClient.get('/me').catch((e: unknown) => e);
    expect(normalizeApiError(error).kind).toBe('unauthorized');
    expect(sessionExpired).toHaveBeenCalledTimes(1);
    expect(requests.map((r) => r.url)).toEqual(['/me', '/auth/refresh']);
  });

  it('surfaces a transient refresh failure as that failure (network), keeping the session', async () => {
    route = api(offline, 'at-2');

    const error = await apiClient.get('/me').catch((e: unknown) => e);
    expect(normalizeApiError(error).kind).toBe('network');
    expect(sessionExpired).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('at-1');
    expect(storedRefreshToken).toBe('rt-1');
  });

  it('never refreshes for a 401 from /auth/login', async () => {
    route = (config) => reply(config, 401);
    const error = await apiClient.post('/auth/login', {}).catch((e: unknown) => e);
    expect(normalizeApiError(error).statusCode).toBe(401);
    expect(refreshCalls()).toHaveLength(0);
    expect(sessionExpired).not.toHaveBeenCalled();
  });
});
