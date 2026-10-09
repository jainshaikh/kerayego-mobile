import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { authApi, type LoginPayload, type RegisterPayload } from '../api/auth.api';
import { usersApi } from '../api/users.api';
import { refreshAccessToken, setAccessToken, setOnSessionExpired } from '../api/client';
import { clearAllAuthStorage, getRefreshToken, setRefreshToken } from '../storage/secure-storage';
import { disconnectRideSocket } from '../features/liveRide/socket';
import {
  setDriverLocationSessionUser,
  stopDriverLocationSharing,
} from '../features/liveRide/backgroundLocation/driverLocationSharing';
import { setOfflineQueueOwner } from '../features/trips/offlineSync';
import {
  invalidateDevicePushToken,
  registerPushToken,
  unregisterPushToken,
} from '../features/notifications/pushToken';
import type { AuthUser, User } from '../types/api.types';

interface AuthContextValue {
  user: AuthUser | User | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (data: LoginPayload) => Promise<AuthUser>;
  register: (data: RegisterPayload) => Promise<{ message: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// 'logout': the user signed out (the push token was already unregistered with
// the backend). 'expired': the refresh token was rejected — no valid access
// token is left for any backend cleanup call.
type SessionEndReason = 'logout' | 'expired';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const queryClient = useQueryClient();

  const clearSession = useCallback(
    async (reason: SessionEndReason) => {
      // Stops any queue flush still running for this user before their token
      // goes. Their queued trip actions themselves stay on the device — on
      // logout and on expiry alike — and replay only once they sign back in
      // (offline-trip-queue.ts scopes every read to its user).
      setOfflineQueueOwner(null);
      // Background driver location stops with the session — before its
      // token goes, so the task never posts under nobody (or the next
      // account). Best-effort, not awaited: it only talks to the OS.
      setDriverLocationSessionUser(null);
      void stopDriverLocationSharing('signed_out');
      setAccessToken(null);
      // The ride socket stays authenticated as whoever it handshook as until
      // it's closed — tear it down before anyone else can sign in here.
      disconnectRideSocket();
      if (reason === 'expired') {
        // Logout unregisters the push token with the backend first; an
        // expired session can't, so stop this device receiving the expired
        // user's pushes natively instead. Best-effort, not awaited.
        invalidateDevicePushToken();
      }
      await clearAllAuthStorage();
      setUser(null);
      queryClient.clear();
    },
    [queryClient],
  );

  useEffect(() => {
    setOnSessionExpired(() => {
      clearSession('expired');
    });

    (async () => {
      try {
        const storedRefreshToken = await getRefreshToken();
        if (!storedRefreshToken) {
          setIsBootstrapping(false);
          return;
        }

        const newAccessToken = await refreshAccessToken();
        if (!newAccessToken) {
          await clearAllAuthStorage();
          setIsBootstrapping(false);
          return;
        }

        const me = await usersApi.getMe();
        setOfflineQueueOwner(me.id);
        setDriverLocationSessionUser(me.id);
        setUser(me);
        registerPushToken();
      } catch {
        await clearAllAuthStorage();
        setAccessToken(null);
      } finally {
        setIsBootstrapping(false);
      }
    })();

    return () => setOnSessionExpired(null);
  }, [clearSession]);

  const login = useCallback(async (data: LoginPayload) => {
    const result = await authApi.login(data);
    setAccessToken(result.accessToken);
    setOfflineQueueOwner(result.user.id);
    setDriverLocationSessionUser(result.user.id);
    if (result.refreshToken) {
      await setRefreshToken(result.refreshToken);
    }
    setUser(result.user);
    registerPushToken();
    return result.user;
  }, []);

  const register = useCallback(async (data: RegisterPayload) => {
    const result = await authApi.register(data);
    return { message: result.message };
  }, []);

  const logout = useCallback(async () => {
    // Must run before clearSession — it needs the still-valid access token
    // to authenticate the unregister call.
    await unregisterPushToken();
    try {
      await authApi.logout();
    } catch {
      // Best-effort — clear local session regardless of network/server outcome.
    }
    await clearSession('logout');
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      isBootstrapping,
      login,
      register,
      logout,
    }),
    [user, isBootstrapping, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
