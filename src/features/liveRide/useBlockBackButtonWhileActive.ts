import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * Locks the current screen in place while `active` is true: the hardware
 * back button is swallowed (returning true = "handled") instead of
 * navigating away, released again the instant `active` turns false or the
 * screen unmounts. Used by both the driver cockpit (my-trips/[id].tsx) and
 * the rider's trip-request/[id].tsx while their ride lock holds.
 *
 * This only covers the hardware back button — the native stack header's own
 * back chevron and the swipe-back gesture are a separate exit path, which
 * both of those screens suppress through their own screen-level
 * `Stack.Screen` options (headerShown/gestureEnabled false) on the same flag.
 */
export function useBlockBackButtonWhileActive(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [active]);
}
