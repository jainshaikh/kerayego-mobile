import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

function subscribe(listener: () => void): () => void {
  const subscription = AppState.addEventListener('change', listener);
  return () => subscription.remove();
}

// iOS's brief 'inactive' (the app switcher, a pulled-down notification
// centre, an incoming-call banner) still counts as in the foreground; only
// 'background' doesn't.
function getInForeground(): boolean {
  return AppState.currentState !== 'background';
}

/** Whether the app is in the foreground — re-renders the caller when it moves to or from the background. */
export function useAppInForeground(): boolean {
  return useSyncExternalStore(subscribe, getInForeground, getInForeground);
}
