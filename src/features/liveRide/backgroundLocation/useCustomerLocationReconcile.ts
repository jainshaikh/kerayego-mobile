import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

import { useAppInForeground } from '../../../hooks/useAppInForeground';
import type { LocationShareTarget } from '../../../types/api.types';
import { useMyLocationSharing } from '../queries';
import {
  findShareTarget,
  isCustomerServerStopReason,
  nextOpensAtDelayMs,
  shareTargetKey,
} from './customerLocationRules';
import {
  ensureCustomerLocationSharing,
  getCustomerLocationStatus,
  getCustomerSharingRetryCount,
  reconcileCustomerLocationSharing,
  reportCustomerLocationPermissionMissing,
  subscribeCustomerLocationStatus,
  subscribeCustomerSharingRetry,
} from './customerLocationSharing';
import {
  getBackgroundLocationStatus,
  isBackgroundLocationSupported,
  subscribeBackgroundLocationStatus,
} from './driverLocationSharing';

export interface CustomerLocationPermissionPrompt {
  // The window the explanation is for; null when it's closed.
  target: LocationShareTarget | null;
  // "Continue": the OS permission dialog, then sharing.
  allow: () => void;
  // "Not now" / × / tap outside: not asked again for that window this run
  // (the sharing card's "Turn on" asks again).
  dismiss: () => void;
}

async function readPermission(): Promise<Location.LocationPermissionResponse | null> {
  try {
    return await Location.getForegroundPermissionsAsync();
  } catch {
    return null;
  }
}

/**
 * Root-level driver of the customer's location sharing
 * (customerLocationSharing.ts), wherever they are in the app: asks GET
 * /users/me/location-sharing on every return to the foreground, every 60 s
 * while the app is open, and when the next window opens (nextOpensAt); stops
 * sharing that no longer belongs (no window, a different one, paused, another
 * account, the driver task sharing for this person, a 404/403/409 from the
 * location endpoint — which also re-checks) and starts it for the first open,
 * non-paused window — from the foreground only, once "While using the app"
 * location is allowed. Before the first OS prompt it shows a short
 * explanation (the returned prompt, rendered by the root layout).
 *
 * `ready`: the session restore is done — until then who's signed in isn't known.
 */
export function useCustomerLocationReconcile(
  ready: boolean,
  userId: string | undefined,
): CustomerLocationPermissionPrompt {
  const inForeground = useAppInForeground();
  const sessionUserId = ready ? (userId ?? null) : undefined;
  const signedIn = !!sessionUserId && Platform.OS !== 'web';
  const { data: sharing, dataUpdatedAt, refetch } = useMyLocationSharing(signedIn, inForeground);
  const retryCount = useSyncExternalStore(
    subscribeCustomerSharingRetry,
    getCustomerSharingRetryCount,
    getCustomerSharingRetryCount,
  );
  const driverStatus = useSyncExternalStore(
    subscribeBackgroundLocationStatus,
    getBackgroundLocationStatus,
    getBackgroundLocationStatus,
  );
  const driverActive = driverStatus.state === 'starting' || driverStatus.state === 'running';
  const customerStatus = useSyncExternalStore(
    subscribeCustomerLocationStatus,
    getCustomerLocationStatus,
    getCustomerLocationStatus,
  );

  // The window the explanation is open for, and for whom — a prompt left
  // over from another session is never shown.
  const [prompt, setPrompt] = useState<{ userId: string; target: LocationShareTarget } | null>(null);
  const promptTarget = prompt && prompt.userId === sessionUserId ? prompt.target : null;
  // Windows (per user) whose explanation was dismissed this run — not shown
  // again unprompted. Cleared by the card's "Turn on" (a retry).
  const dismissedRef = useRef(new Set<string>());
  const handledRetryRef = useRef(retryCount);

  // Back in the foreground: ask again straight away.
  useEffect(() => {
    if (signedIn && inForeground) void refetch();
  }, [signedIn, inForeground, refetch]);

  // A window opens soon: ask again right then.
  const nextOpensAt = sharing?.nextOpensAt ?? null;
  useEffect(() => {
    if (!signedIn || !inForeground) return;
    const delay = nextOpensAtDelayMs(nextOpensAt, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(timer);
  }, [signedIn, inForeground, nextOpensAt, refetch]);

  // The location endpoint refused the target (404/403/409): re-check.
  useEffect(() => {
    if (!signedIn) return;
    if (customerStatus.state === 'stopped' && isCustomerServerStopReason(customerStatus.reason)) void refetch();
  }, [signedIn, customerStatus, refetch]);

  useEffect(() => {
    if (sessionUserId === undefined || Platform.OS === 'web') return;
    let cancelled = false;
    const retried = handledRetryRef.current !== retryCount;
    handledRetryRef.current = retryCount;
    if (retried) dismissedRef.current.clear();

    (async () => {
      const target = await reconcileCustomerLocationSharing({
        userId: sessionUserId,
        sharing: sessionUserId ? sharing : undefined,
      });
      // Android can't start a location foreground service from the
      // background — wait for the app to come back.
      if (cancelled || !target || !sessionUserId || !inForeground) return;
      // A build without background location: the start reports 'unavailable'.
      if (!isBackgroundLocationSupported()) {
        await ensureCustomerLocationSharing(target, sessionUserId);
        return;
      }
      const permission = await readPermission();
      if (cancelled) return;
      if (permission?.granted) {
        await ensureCustomerLocationSharing(target, sessionUserId);
        return;
      }
      const canAsk = permission?.canAskAgain !== false;
      if (canAsk && !dismissedRef.current.has(`${sessionUserId}|${shareTargetKey(target)}`)) {
        setPrompt({ userId: sessionUserId, target });
        return;
      }
      reportCustomerLocationPermissionMissing(target);
      // "Turn on" with the OS no longer asking: only Settings can grant it.
      if (retried && !canAsk) Linking.openSettings().catch(() => undefined);
    })();

    return () => {
      cancelled = true;
    };
    // dataUpdatedAt: every answer re-runs it, even an unchanged one — a
    // target the server refused becomes startable again after a while.
    // driverActive: the driver task starting stops this one at once.
  }, [sessionUserId, sharing, dataUpdatedAt, inForeground, retryCount, driverActive]);

  const allow = useCallback(() => {
    const target = promptTarget;
    setPrompt(null);
    if (!target || !sessionUserId) return;
    void (async () => {
      let granted = false;
      try {
        granted = (await Location.requestForegroundPermissionsAsync()).granted;
      } catch {
        granted = false;
      }
      if (granted) await ensureCustomerLocationSharing(target, sessionUserId);
      else reportCustomerLocationPermissionMissing(target);
    })();
  }, [promptTarget, sessionUserId]);

  const dismiss = useCallback(() => {
    const target = promptTarget;
    setPrompt(null);
    if (!target || !sessionUserId) return;
    dismissedRef.current.add(`${sessionUserId}|${shareTargetKey(target)}`);
    reportCustomerLocationPermissionMissing(target);
  }, [promptTarget, sessionUserId]);

  // Only while that window is still open and not paused.
  const listed = promptTarget ? findShareTarget(sharing, promptTarget) : null;
  const visibleTarget = listed && !listed.paused && inForeground ? listed : null;

  return { target: visibleTarget, allow, dismiss };
}
