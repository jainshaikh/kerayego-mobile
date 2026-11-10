import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { authApi, type PhoneRegisterPayload, type PhoneVerifyPayload, type VerifyCodePayload } from '../api/auth.api';
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
import type { AuthUser, LoginResult, PhoneSignupRequired, User } from '../types/api.types';
import { SESSION_RESTORE_RETRY_MS, sessionRestoreFailureAction } from './sessionRestore';

interface AuthContextValue {
  user: AuthUser | User | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  /**
   * True while a stored session couldn't be restored because the server
   * couldn't be reached (an app start offline, or during server trouble): the
   * refresh token is kept and the restore retried while the app is open, so
   * the person is signed back in once it goes through. Signed out meanwhile.
   */
  isRestoringSession: boolean;
  /**
   * POST /auth/code/verify, then stores the session (as the old password
   * login did) and re-reads the user — a code sign-in verifies the email.
   */
  signInWithCode: (data: VerifyCodePayload) => Promise<AuthUser | User>;
  /**
   * POST /auth/phone/verify. A number with an account: stores the session
   * exactly as signInWithCode does and resolves { needsSignup: false, user }.
   * No account yet: no session — resolves the signupToken for the profile step.
   */
  signInWithPhone: (data: PhoneVerifyPayload) => Promise<PhoneSignInOutcome>;
  /** POST /auth/phone/register (role USER), then the same session storing. */
  registerWithPhone: (data: PhoneRegisterPayload) => Promise<AuthUser | User>;
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

export type PhoneSignInOutcome = { needsSignup: false; user: AuthUser | User } | PhoneSignupRequired;

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// 'logout': the user signed out (the push token was already unregistered with
// the backend). 'expired': the refresh token was rejected — no valid access
// token is left for any backend cleanup call. 'deleted': the user asked for
// their account to be deleted, which revoked their refresh tokens — treated
// like 'expired', with no backend cleanup call.
type SessionEndReason = 'logout' | 'expired' | 'deleted';

// restoreSession's outcome. 'restored': `user` is the signed-in user, for the
// caller to put in state. 'retry': the server couldn't be reached — the
// refresh token stays stored. 'stale': a sign-in, sign-out or expiry happened
// while it ran, so it did nothing.
type RestoreResult = { kind: 'restored'; user: User } | { kind: 'signedOut' | 'retry' | 'stale' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const [deletionCancelledNotice, setDeletionCancelledNotice] = useState(false);
  const queryClient = useQueryClient();
  // Bumped whenever the session changes hands here (a sign-in, a sign-out or
  // an expiry), so a session restore still in flight from before never acts
  // on what it finds afterwards.
  const sessionGenerationRef = useRef(0);
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
      sessionGenerationRef.current += 1;
      setIsRestoringSession(false);
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

  // The stored session: refresh token → POST /auth/refresh → GET /users/me.
  // Never rejects, and sets no React state itself (the caller puts the user in
  // state). A failure that says nothing about the session (offline, 5xx —
  // sessionRestoreFailureAction) keeps the refresh token for a retry; only the
  // server refusing it signs the person out.
  const restoreSession = useCallback(async (): Promise<RestoreResult> => {
    const generation = sessionGenerationRef.current;
    const isStale = () => generation !== sessionGenerationRef.current;
    try {
      const storedRefreshToken = await getRefreshToken();
      if (isStale()) return { kind: 'stale' };
      if (!storedRefreshToken) return { kind: 'signedOut' };

      // null: no session left (the backend refused the token, and
      // refreshAccessToken has already expired it).
      const newAccessToken = await refreshAccessToken();
      if (isStale()) return { kind: 'stale' };
      if (!newAccessToken) {
        await clearAllAuthStorage();
        return { kind: 'signedOut' };
      }

      const me = await usersApi.getMe();
      if (isStale()) return { kind: 'stale' };
      setOfflineQueueOwner(me.id);
      setDriverLocationSessionUser(me.id);
      setCustomerLocationSessionUser(me.id);
      registerPushToken();
      return { kind: 'restored', user: me };
    } catch (error) {
      if (isStale()) return { kind: 'stale' };
      // Nobody is signed in until a restore completes — drop any access token
      // a refresh that did go through left in memory.
      setAccessToken(null);
      if (sessionRestoreFailureAction(error) === 'retry') return { kind: 'retry' };
      await clearAllAuthStorage().catch(() => {});
      return { kind: 'signedOut' };
    }
  }, []);

  useEffect(() => {
    setOnSessionExpired(() => {
      clearSession('expired');
    });
    setOnPhoneNotVerified(recheckPhoneVerification);

    void restoreSession().then((result) => {
      if (result.kind === 'restored') setUser(result.user);
      if (result.kind === 'retry') setIsRestoringSession(true);
      setIsBootstrapping(false);
    });

    return () => {
      setOnSessionExpired(null);
      setOnPhoneNotVerified(null);
    };
  }, [clearSession, recheckPhoneVerification, restoreSession]);

  // A stored session the server couldn't be reached for: try again while the
  // app is open — on every return to the foreground and every 15 s — until it
  // goes through, the server refuses it, or someone signs in or out.
  useEffect(() => {
    if (!isRestoringSession) return;
    let cancelled = false;
    let inFlight = false;
    const attempt = async () => {
      if (inFlight || AppState.currentState === 'background') return;
      inFlight = true;
      try {
        const result = await restoreSession();
        if (result.kind === 'restored') setUser(result.user);
        if (!cancelled && result.kind !== 'retry') setIsRestoringSession(false);
      } finally {
        inFlight = false;
      }
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void attempt();
    });
    const interval = setInterval(() => void attempt(), SESSION_RESTORE_RETRY_MS);
    return () => {
      cancelled = true;
      subscription.remove();
      clearInterval(interval);
    };
  }, [isRestoringSession, restoreSession]);

  // Every sign-in's session (email code, phone code, phone sign-up — all the
  // /auth/login shape, refresh token in the body for X-Client-Type: mobile).
  const startSession = useCallback(async (result: LoginResult) => {
    sessionGenerationRef.current += 1;
    setIsRestoringSession(false);
    setAccessToken(result.accessToken);
    setOfflineQueueOwner(result.user.id);
    setDriverLocationSessionUser(result.user.id);
    setCustomerLocationSessionUser(result.user.id);
    if (result.refreshToken) {
      await setRefreshToken(result.refreshToken);
    }
    // The code proved the email or the phone (emailVerified / phoneVerified,
    // PENDING_VERIFICATION → ACTIVE) — read the user back so nothing keeps
    // showing them as unverified. The sign-in's own user is the fallback if
    // that read fails.
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

  const signInWithCode = useCallback(
    async (data: VerifyCodePayload) => startSession(await authApi.verifyCode(data)),
    [startSession],
  );

  const signInWithPhone = useCallback(
    async (data: PhoneVerifyPayload): Promise<PhoneSignInOutcome> => {
      const result = await authApi.verifyPhoneCode(data);
      if (result.needsSignup) return result;
      return { needsSignup: false, user: await startSession(result) };
    },
    [startSession],
  );

  const registerWithPhone = useCallback(
    async (data: PhoneRegisterPayload) => startSession(await authApi.registerWithPhone(data)),
    [startSession],
  );

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
      isRestoringSession,
      signInWithCode,
      signInWithPhone,
      registerWithPhone,
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
      isRestoringSession,
      signInWithCode,
      signInWithPhone,
      registerWithPhone,
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
