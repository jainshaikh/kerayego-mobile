import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * Locks the current screen in place while `active` is true: the hardware
 * back button is swallowed (returning true = "handled") instead of
 * navigating away, released again the instant `active` turns false or the
 * screen unmounts. Used by both the driver cockpit and the rider live view
 * while their trip is actually in progress.
 *
 * This only covers the hardware/gesture-independent back button — the
 * native stack header's own back chevron and swipe-back gesture are a
 * separate exit path, suppressed independently via each screen's own
 * `Stack.Screen` options.
 */
export function useBlockBackButtonWhileActive(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [active]);
}
