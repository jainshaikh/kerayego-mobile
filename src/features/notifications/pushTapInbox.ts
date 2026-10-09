import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Holds the notification tap the app still has to act on. A tap can land
// long before the app can navigate — a cold start from the tray runs this
// module while the session is still being restored and before any navigator
// has mounted — so taps are captured here, at module scope, and drained by
// usePushTapNavigation (app/_layout.tsx) once routing is possible.

export interface PushTap {
  // The notification's request identifier — the same tap can arrive twice
  // (the response listener and getLastNotificationResponse on a cold start).
  key: string;
  data: unknown;
  capturedAt: number;
}

// A tap that couldn't be acted on for this long (e.g. it opened the app
// signed out and nobody signed in) is dropped: landing on that trip much
// later, right after some unrelated login, would be a surprise.
export const PUSH_TAP_MAX_AGE_MS = 10 * 60_000;

// Taps already taken, remembered so the second delivery of one is ignored.
const SEEN_KEYS_LIMIT = 20;

export interface PushTapInbox {
  capture: (tap: PushTap) => void;
  peek: () => PushTap | null;
  take: () => PushTap | null;
  subscribe: (listener: () => void) => () => void;
  // Bumped on every change — a stable snapshot for useSyncExternalStore.
  getVersion: () => number;
}

export function createPushTapInbox(): PushTapInbox {
  let pending: PushTap | null = null;
  let version = 0;
  const seenKeys: string[] = [];
  const listeners = new Set<() => void>();

  const changed = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };

  return {
    // The newest tap wins: the user's last tap is where they want to go.
    capture(tap) {
      if (seenKeys.includes(tap.key)) return;
      seenKeys.push(tap.key);
      if (seenKeys.length > SEEN_KEYS_LIMIT) seenKeys.shift();
      pending = tap;
      changed();
    },
    peek: () => pending,
    take() {
      const tap = pending;
      if (tap) {
        pending = null;
        changed();
      }
      return tap;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
  };
}

export function isPushTapExpired(tap: PushTap, now: number): boolean {
  return now - tap.capturedAt > PUSH_TAP_MAX_AGE_MS;
}

/** A plain tap on the notification (not a dismissal or a custom action), as a PushTap. */
export function pushTapFromResponse(response: Notifications.NotificationResponse, now: number): PushTap | null {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const { notification } = response;
  return {
    key: notification.request.identifier || `at:${notification.date}`,
    data: notification.request.content.data,
    capturedAt: now,
  };
}

export const pushTapInbox = createPushTapInbox();

function captureResponse(response: Notifications.NotificationResponse): void {
  const tap = pushTapFromResponse(response, Date.now());
  if (tap) pushTapInbox.capture(tap);
  // Taken — so a JS reload later in this process (which re-reads the last
  // response on start) doesn't replay it.
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Not available on this platform — nothing to clear.
  }
}

// The tap that launched (or resumed) the app, if the response listener
// wasn't registered in time to hear it.
export function captureLastNotificationResponse(): void {
  if (Platform.OS === 'web') return;
  try {
    const response = Notifications.getLastNotificationResponse();
    if (response) captureResponse(response);
  } catch (err) {
    console.warn('[pushTaps] could not read the last notification response:', err);
  }
}

let started = false;

/**
 * Starts listening for notification taps for the app's whole lifetime. Call
 * once at module scope of a module loaded at startup (app/_layout.tsx), as
 * the expo-notifications docs require, so no tap is missed.
 */
export function startPushTapCapture(): void {
  if (started || Platform.OS === 'web') return;
  started = true;
  Notifications.addNotificationResponseReceivedListener(captureResponse);
  captureLastNotificationResponse();
}
