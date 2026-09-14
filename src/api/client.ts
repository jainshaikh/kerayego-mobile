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

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
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

let isRefreshing = false;
let refreshSubscribers: ((token: string | null) => void)[] = [];

function subscribeToRefresh(callback: (token: string | null) => void) {
  refreshSubscribers.push(callback);
}

function notifyRefreshSubscribers(token: string | null) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

/** Exposed for explicit use during session bootstrap (app launch) — see auth/auth-session.ts. */
export async function refreshAccessToken(): Promise<string | null> {
  return performRefresh();
}

async function performRefresh(): Promise<string | null> {
  const storedRefreshToken = await getRefreshToken();
  if (!storedRefreshToken) return null;

  const response = await apiClient.post<ApiResponse<RefreshResult>>(
    '/auth/refresh',
    {
      refreshToken: storedRefreshToken,
    },
  );

  const result = response.data.data;
  setAccessToken(result.accessToken);
  if (result.refreshToken) {
    await setRefreshToken(result.refreshToken);
  }
  return result.accessToken;
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
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !isAuthRoute
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          subscribeToRefresh((newToken) => {
            if (!newToken) {
              reject(error);
              return;
            }
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await performRefresh();

        if (!newToken) {
          throw error;
        }

        notifyRefreshSubscribers(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        notifyRefreshSubscribers(null);
        setAccessToken(null);
        await clearAllAuthStorage();
        onSessionExpired?.();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
