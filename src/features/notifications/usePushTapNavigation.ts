import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, useNavigationContainerRef, usePathname, type Href } from 'expo-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { tripInquiriesApi } from '../../api/trip-inquiries.api';
import type { MyActiveRide } from '../../api/trips.api';
import { normalizeApiError } from '../../api/errors';
import { captureLastNotificationResponse, isPushTapExpired, pushTapInbox, type PushTap } from './pushTapInbox';
import {
  activeRidePathname,
  legacyFallbackRoute,
  pushInvalidationKeys,
  pushNavigationStep,
  resolvePushTarget,
  routeForResolvedInquiry,
  type PushRoute,
} from './pushRouting';

// How soon to look again when a tap is ready to route but the navigator
// hasn't finished mounting yet (it renders on the same pass as `ready`).
const NAVIGATOR_RETRY_MS = 100;

interface PushTapNavigationOptions {
  // RootNavigator's isReady: fonts loaded and the session restore finished,
  // so the navigator is rendering.
  ready: boolean;
  // The signed-in user, undefined while signed out.
  userId: string | undefined;
  // On a login/register/verify screen — those navigate away by themselves
  // once they're done, and would overwrite a destination pushed meanwhile.
  onAuthScreen: boolean;
}

/**
 * Acts on notification taps (captured in pushTapInbox from app start, cold
 * start included) once routing is possible: the session restored, someone
 * signed in — a tap that opened the app signed out waits for the login,
 * within PUSH_TAP_MAX_AGE_MS — off the auth screens, and the navigator
 * mounted. Each tap is routed once, by resolvePushTarget, for that user.
 */
export function usePushTapNavigation({ ready, userId, onAuthScreen }: PushTapNavigationOptions): void {
  const queryClient = useQueryClient();
  const navigationRef = useNavigationContainerRef();
  const pathname = usePathname();
  const tapVersion = useSyncExternalStore(pushTapInbox.subscribe, pushTapInbox.getVersion, pushTapInbox.getVersion);
  const [navigatorCheck, setNavigatorCheck] = useState(0);

  // Read again after the legacy lookup's await — the user may have moved
  // on to another screen, or signed out, by the time it answers.
  const pathnameRef = useRef(pathname);
  const userIdRef = useRef(userId);
  useEffect(() => {
    pathnameRef.current = pathname;
    userIdRef.current = userId;
  });

  // The module-scope read (startPushTapCapture) can run before native code
  // has recorded the tap that launched the app — look once more on mount.
  useEffect(() => {
    captureLastNotificationResponse();
  }, []);

  useEffect(() => {
    const tap = pushTapInbox.peek();
    if (!tap) return;
    if (isPushTapExpired(tap, Date.now())) {
      pushTapInbox.take();
      return;
    }
    if (!ready || !userId || onAuthScreen) return;
    // Navigating before the root navigator exists throws (inside
    // expo-router's own effect, where nothing here could catch it).
    if (!navigationRef.isReady()) {
      const timer = setTimeout(() => setNavigatorCheck((count) => count + 1), NAVIGATOR_RETRY_MS);
      return () => clearTimeout(timer);
    }
    pushTapInbox.take();
    void handlePushTap(tap, userId, {
      queryClient,
      currentPathname: () => pathnameRef.current,
      stillSignedInAs: (id) => userIdRef.current === id,
    });
  }, [tapVersion, navigatorCheck, ready, userId, onAuthScreen, navigationRef, queryClient]);
}

/**
 * Refreshes whatever a push says is out of date when it arrives while the
 * app is open (e.g. the rider's screen learns of a no-show mark at once
 * instead of on its 20 s poll). Taps do the same in handlePushTap.
 */
export function usePushReceivedInvalidation(userId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      invalidatePushQueries(queryClient, notification.request.content.data, userId);
    });
    return () => subscription.remove();
  }, [queryClient, userId]);
}

function invalidatePushQueries(queryClient: QueryClient, data: unknown, userId: string): void {
  for (const queryKey of pushInvalidationKeys(data, userId)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

interface PushTapContext {
  queryClient: QueryClient;
  currentPathname: () => string;
  stillSignedInAs: (userId: string) => boolean;
}

async function handlePushTap(tap: PushTap, userId: string, context: PushTapContext): Promise<void> {
  // The app was in the background (or not running) — what the push is
  // about has changed since anything cached was fetched.
  invalidatePushQueries(context.queryClient, tap.data, userId);

  const target = resolvePushTarget(tap.data, userId);
  if (target.kind === 'none') return;
  if (target.kind === 'route') {
    navigateToPushRoute(target.route, context);
    return;
  }

  // An older backend's payload: the request itself says whose trip it is.
  let route: PushRoute | null;
  try {
    const inquiry = await context.queryClient.fetchQuery({
      queryKey: ['tripInquiry', target.inquiryId],
      queryFn: () => tripInquiriesApi.getOne(target.inquiryId),
      staleTime: 0,
      // The user is waiting on this tap — one attempt, then the fallback.
      retry: false,
    });
    route = routeForResolvedInquiry(inquiry, userId, target.openChat);
  } catch (error) {
    route = legacyFallbackRoute(target, normalizeApiError(error).kind);
  }
  if (route && context.stillSignedInAs(userId)) navigateToPushRoute(route, context);
}

function navigateToPushRoute(route: PushRoute, context: PushTapContext): void {
  // The ride lock as last fetched — it polls every 20 s; the refetch this
  // push triggered may still be on its way.
  const lockedPathname = activeRidePathname(context.queryClient.getQueryData<MyActiveRide>(['myActiveRide']));
  const step = pushNavigationStep(route, context.currentPathname(), lockedPathname);
  if (step.kind === 'push') {
    // A runtime-built path: typed routes can't check a plain string (same
    // cast as the active-ride lock's).
    router.push(step.href as Href);
  } else if (step.kind === 'setParams') {
    router.setParams(step.params);
  }
}
