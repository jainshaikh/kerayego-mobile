import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../constants/config';
import {
  clearAllAuthStorage,
  getRefreshToken,
  setRefreshToken,
} from '../storage/secure-storage';
import type { ApiResponse, RefreshResult } from '../types/api.types';

// Access token lives in memory only — never persisted, so it disappears on app kill.
// This mirrors the web client's approach; the refresh token (in SecureStore) is what
// survives app restarts and is used to silently mint a new access token on boot.
let accessToken: string | null = null;

// Bumped every time the session changes hands from outside this module —
// login, logout, session expiry (every setAccessToken call; a token refresh
// does not go through it). A refresh still in flight from the previous
// session checks it before writing anything back, so it can neither revive a
// logged-out session's tokens nor expire the next account's session with its
// own late rejection.
let sessionEpoch = 0;

export function getAccessToken(): string | null {
  return accessToken;
}

/** For AuthProvider only: login, logout and session expiry — starts a new session epoch. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
  sessionEpoch += 1;
}

// Registered by AuthProvider — called when a refresh attempt fails so the app can
// clear its user state and fall back to the auth flow. Kept as a callback (rather
// than importing auth-context here) to avoid a circular dependency.
let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    // Tells the backend to also return the refresh token in the response body
    // (httpOnly cookies aren't usable the way they are in a browser). See
    // kerayego-backend auth.controller.ts `isMobileClient`.
    'X-Client-Type': 'mobile',
  },
});

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (accessToken && config.headers) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// --- shared single-flight token refresh -----------------------------------

let refreshFlight: { epoch: number; promise: Promise<string | null> } | null = null;

/**
 * The one way to mint a new access token in this app, shared by the 401
 * interceptor below, the live-ride socket's reconnect
 * (features/liveRide/socket.ts) and the session bootstrap (auth-context.tsx).
 * The backend rotates the refresh token on every use and rejects a second
 * presentation of the same one (401 "Refresh already in progress", or a
 * revoked token family for a reused one), so concurrent callers share a single
 * in-flight request instead of each presenting the stored token.
 *
 * Resolves with the new access token, or `null` when there is no session
 * left: no stored refresh token, or the backend rejected it (401/403) — in
 * which case the session has already been expired (storage cleared,
 * AuthProvider notified), once. Rejects on a transient failure (offline,
 * timeout, 5xx, 429) and leaves the session intact, so the caller can retry.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshFlight && refreshFlight.epoch === sessionEpoch) return refreshFlight.promise;

  const epoch = sessionEpoch;
  const promise = refreshOrExpire(epoch).finally(() => {
    if (refreshFlight?.promise === promise) refreshFlight = null;
  });
  refreshFlight = { epoch, promise };
  return promise;
}

async function refreshOrExpire(epoch: number): Promise<string | null> {
  const storedRefreshToken = await getRefreshToken();
  if (!storedRefreshToken) {
    // Nothing persisted to refresh with. An access token still in memory
    // means a live session just lost its refresh token — expire it; with
    // neither (a guest, or a session already cleared) there is nothing to
    // tear down.
    if (accessToken !== null) await expireSession(epoch);
    return null;
  }

  let result: RefreshResult;
  try {
    const response = await apiClient.post<ApiResponse<RefreshResult>>('/auth/refresh', {
      refreshToken: storedRefreshToken,
    });
    result = response.data.data;
  } catch (error) {
    // Offline, a timeout, a 5xx or a 429 says nothing about the session —
    // keep it; only the backend actually refusing the token ends it.
    if (!isRefreshRejected(error)) throw error;
    await expireSession(epoch);
    return null;
  }

  // Logged out (or another account logged in) while this was in flight:
  // these tokens belong to a session that no longer exists on this device.
  if (epoch !== sessionEpoch) return null;

  accessToken = result.accessToken;
  if (result.refreshToken) {
    await setRefreshToken(result.refreshToken);
  }
  return result.accessToken;
}

// 401: unknown/expired/revoked/already-rotated token. 403: suspended account
// (auth.service.ts refresh).
function isRefreshRejected(error: unknown): boolean {
  const status = error instanceof AxiosError ? error.response?.status : undefined;
  return status === 401 || status === 403;
}

async function expireSession(epoch: number): Promise<void> {
  // A newer session (a fresh login) has already replaced the one this
  // refresh belonged to — not ours to end.
  if (epoch !== sessionEpoch) return;
  setAccessToken(null);
  try {
    await clearAllAuthStorage();
  } catch (err) {
    console.warn('[apiClient] failed to clear stored auth after session expiry:', err);
  }
  onSessionExpired?.();
}

function bearerTokenOf(config: InternalAxiosRequestConfig): string | null {
  const header = config.headers?.Authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    const isAuthRoute =
      originalRequest?.url?.includes('/auth/refresh') ||
      originalRequest?.url?.includes('/auth/login');

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthRoute
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    // If another caller already refreshed while this request was in flight,
    // it went out with the old token — retry with the current one rather than
    // rotating the refresh token a second time. Otherwise join (or start) the
    // shared refresh; a transient refresh failure rejects right here with its
    // own network/server error and the session is kept.
    const current = accessToken;
    const newToken =
      current !== null && current !== bearerTokenOf(originalRequest)
        ? current
        : await refreshAccessToken();

    // No session left — refreshAccessToken() has already expired it.
    if (!newToken) {
      return Promise.reject(error);
    }

    originalRequest.headers.Authorization = `Bearer ${newToken}`;
    return apiClient(originalRequest);
  },
);

export default apiClient;
