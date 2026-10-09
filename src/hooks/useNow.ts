import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

const TICK_MS = 1000;

// One shared 1 s clock for every ticking label on screen (the driver's stop
// wait timers and no-show countdowns): however many are showing, it costs one
// interval — and none at all while nothing that's visible needs it, or while
// the app is in the background.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

function tick(): void {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

function startTimer(): void {
  if (!timer) timer = setInterval(tick, TICK_MS);
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function onAppStateChange(state: AppStateStatus): void {
  if (state === 'active') {
    tick();
    startTimer();
  } else if (state === 'background') {
    stopTimer();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    // Fresh for the first subscriber — React re-reads the snapshot right
    // after subscribing, so a label that was hidden for a while never shows
    // a stale value for a whole tick.
    now = Date.now();
    if (AppState.currentState !== 'background') startTimer();
    appStateSubscription = AppState.addEventListener('change', onAppStateChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTimer();
      appStateSubscription?.remove();
      appStateSubscription = null;
    }
  };
}

function subscribeNever(): () => void {
  return () => {};
}

function getNow(): number {
  return now;
}

/**
 * The device time in ms, re-rendering the caller once a second while
 * `enabled` (pass false while its label is off screen, e.g. on a hidden tab).
 * Disabled, it returns the shared clock's last value without re-rendering.
 */
export function useNow(enabled: boolean): number {
  return useSyncExternalStore(enabled ? subscribe : subscribeNever, getNow, getNow);
}
