import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { authApi, type RegisterPayload, type VerifyCodePayload } from '../api/auth.api';
import { usersApi } from '../api/users.api';
import { refreshAccessToken, setAccessToken, setOnPhoneNotVerified, setOnSessionExpired } from '../api/client';
import { clearAllAuthStorage, getRefreshToken, setRefreshToken } from '../storage/secure-storage';
import { disconnectRideSocket } from '../features/liveRide/socket';
import {
  setDriverLocationSessionUser,
  stopDriverLocationSharing,
} from '../features/liveRide/backgroundLocation/driverLocationSharing';
import {
  setCustomerLocationSessionUser,
  stopCustomerLocationSharing,
} from '../features/liveRide/backgroundLocation/customerLocationSharing';
import { setOfflineQueueOwner } from '../features/trips/offlineSync';
import {
  invalidateDevicePushToken,
  registerPushToken,
  unregisterPushToken,
} from '../features/notifications/pushToken';
import { needsPhoneVerification, userAfterPhoneNotVerified } from '../features/phone-verification/phoneVerification';
import type { AuthUser, User } from '../types/api.types';

interface AuthContextValue {
  user: AuthUser | User | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  /**
   * POST /auth/code/verify, then stores the session (as the old password
   * login did) and re-reads the user — a code sign-in verifies the email.
   */
  signInWithCode: (data: VerifyCodePayload) => Promise<AuthUser | User>;
  /** POST /auth/register without a password — the code screen follows. */
  register: (data: RegisterPayload) => Promise<{ message: string; codeSent: boolean }>;
  /** Re-reads GET /users/me into `user` (e.g. after the email is verified). */
  refreshUser: () => Promise<void>;
  /**
   * Replaces `user` (and the ['me'] query) with one the server just returned
   * — e.g. POST /users/me/phone/verify's, which lifts the phone gate.
   */
  replaceUser: (user: User) => void;
  /**
   * True after a sign-in that cancelled a pending account deletion, until
   * the "Welcome back" message is closed — shown once.
   */
  deletionCancelledNotice: boolean;
  dismissDeletionCancelledNotice: () => void;
  logout: () => Promise<void>;
  /**
   * After a successful POST /users/me/delete-request: the backend has already
   * revoked every refresh token, so this clears the local session like logout
   * but makes no backend call (no logout, no push-token unregister).
   */
  endSessionAfterAccountDeletion: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// 'logout': the user signed out (the push token was already unregistered with
// the backend). 'expired': the refresh token was rejected — no valid access
// token is left for any backend cleanup call. 'deleted': the user asked for
// their account to be deleted, which revoked their refresh tokens — treated
// like 'expired', with no backend cleanup call.
type SessionEndReason = 'logout' | 'expired' | 'deleted';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [deletionCancelledNotice, setDeletionCancelledNotice] = useState(false);
  const queryClient = useQueryClient();
  // One GET /users/me at a time for a burst of 403 PHONE_NOT_VERIFIED.
  const phoneRecheck = useRef<Promise<void> | null>(null);
  // Read by that re-check: nothing to re-read while the gate already shows
  // (background polls keep getting the same 403 until the number is verified).
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

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
      // The same for the customer's "sharing your location with your
      // driver" task.
      setCustomerLocationSessionUser(null);
      void stopCustomerLocationSharing('signed_out');
      setAccessToken(null);
      // The ride socket stays authenticated as whoever it handshook as until
      // it's closed — tear it down before anyone else can sign in here.
      disconnectRideSocket();
      if (reason !== 'logout') {
        // Logout unregisters the push token with the backend first; an
        // expired (or deleted) session can't, so stop this device receiving
        // that user's pushes natively instead. Best-effort, not awaited.
        invalidateDevicePushToken();
      }
      await clearAllAuthStorage();
      setUser(null);
      setDeletionCancelledNotice(false);
      queryClient.clear();
    },
    [queryClient],
  );

  // A 403 PHONE_NOT_VERIFIED from any request: re-read the user — its
  // mustVerifyPhone then shows the "Verify your mobile number" screen
  // (PhoneVerificationGate, root layout). GET /users/me is never gated.
  const recheckPhoneVerification = useCallback(() => {
    if (phoneRecheck.current || needsPhoneVerification(userRef.current)) return;
    phoneRecheck.current = (async () => {
      let me: User | null = null;
      try {
        me = await usersApi.getMe();
      } catch {
        // Keep me null — the current user is marked instead.
      }
      setUser((current) => userAfterPhoneNotVerified(current, me));
      if (me) queryClient.setQueryData(['me'], me);
    })().finally(() => {
      phoneRecheck.current = null;
    });
  }, [queryClient]);

  useEffect(() => {
    setOnSessionExpired(() => {
      clearSession('expired');
    });
    setOnPhoneNotVerified(recheckPhoneVerification);

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
        setCustomerLocationSessionUser(me.id);
        setUser(me);
        registerPushToken();
      } catch {
        await clearAllAuthStorage();
        setAccessToken(null);
      } finally {
        setIsBootstrapping(false);
      }
    })();

    return () => {
      setOnSessionExpired(null);
      setOnPhoneNotVerified(null);
    };
  }, [clearSession, recheckPhoneVerification]);

  const signInWithCode = useCallback(async (data: VerifyCodePayload) => {
    const result = await authApi.verifyCode(data);
    setAccessToken(result.accessToken);
    setOfflineQueueOwner(result.user.id);
    setDriverLocationSessionUser(result.user.id);
    setCustomerLocationSessionUser(result.user.id);
    if (result.refreshToken) {
      await setRefreshToken(result.refreshToken);
    }
    // The code proved the email (emailVerified, PENDING_VERIFICATION →
    // ACTIVE) — read the user back so nothing keeps showing them as
    // unverified. The sign-in's own user is the fallback if that read fails.
    let signedIn: AuthUser | User = result.user;
    try {
      signedIn = await usersApi.getMe();
    } catch {
      // Keep result.user.
    }
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    setUser(signedIn);
    if (result.deletionCancelled) setDeletionCancelledNotice(true);
    registerPushToken();
    return signedIn;
  }, [queryClient]);

  const register = useCallback(async (data: RegisterPayload) => {
    const { name, email, phone } = data;
    const result = await authApi.register({ name, email, phone });
    return { message: result.message, codeSent: result.codeSent };
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await usersApi.getMe();
    setUser(me);
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const replaceUser = useCallback(
    (next: User) => {
      setUser((current) => (current && current.id === next.id ? next : current));
      queryClient.setQueryData(['me'], next);
    },
    [queryClient],
  );

  const dismissDeletionCancelledNotice = useCallback(() => setDeletionCancelledNotice(false), []);

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

  const endSessionAfterAccountDeletion = useCallback(() => clearSession('deleted'), [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      isBootstrapping,
      signInWithCode,
      register,
      refreshUser,
      replaceUser,
      deletionCancelledNotice,
      dismissDeletionCancelledNotice,
      logout,
      endSessionAfterAccountDeletion,
    }),
    [
      user,
      isBootstrapping,
      signInWithCode,
      register,
      refreshUser,
      replaceUser,
      deletionCancelledNotice,
      dismissDeletionCancelledNotice,
      logout,
      endSessionAfterAccountDeletion,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
