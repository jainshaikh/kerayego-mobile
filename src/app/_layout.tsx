import { useEffect } from 'react';
import { Stack, router, usePathname, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit';

import { queryClient } from '../api/query-client';
import { AuthProvider, useAuth } from '../auth/auth-context';
import { configureNotificationHandler, subscribePushTokenRefresh } from '../features/notifications/pushToken';
import { startPushTapCapture } from '../features/notifications/pushTapInbox';
import { usePushReceivedInvalidation, usePushTapNavigation } from '../features/notifications/usePushTapNavigation';
import { useLiveInquiryNotifications } from '../features/notifications/useLiveInquiryNotifications';
import { activeRidePathname } from '../features/notifications/pushRouting';
import { useMyActiveRide } from '../features/trips/queries';
import { useGlobalOfflineQueueFlush } from '../features/trips/offlineSync';
import { useDriverLocationReconcile } from '../features/liveRide/backgroundLocation/useDriverLocationReconcile';

SplashScreen.preventAutoHideAsync().catch(() => {});
configureNotificationHandler();
// Module scope, before anything renders: a tap that launches the app (or
// lands while the session is still being restored) is held until it can be
// routed — see usePushTapNavigation in RootNavigator.
startPushTapCapture();

function usePushTokenRefresh(isAuthenticated: boolean) {
  useEffect(() => {
    if (!isAuthenticated) return;
    return subscribePushTokenRefresh();
  }, [isAuthenticated]);
}

// Forces a user who reopens the app mid-ride (or who somehow navigates away)
// back onto their locked ride screen. `enabled` must stay false until
// isBootstrapping resolves — otherwise this would poll (and could redirect)
// before we even know whether the user is authenticated.
function useActiveRideLock(enabled: boolean) {
  const pathname = usePathname();
  const { data: activeRide } = useMyActiveRide(enabled);

  useEffect(() => {
    const target = activeRidePathname(activeRide);
    if (!target) return;
    // Only replace() when we're not already there — otherwise every refetch
    // (this polls every 20s) would re-trigger a navigation and this becomes
    // a redirect loop instead of a one-time lock-in. Pathname only: a chat
    // push's ?chatInquiryId= on the locked screen itself is left alone.
    if (pathname !== target) {
      // Cast needed: with typed routes enabled, expo-router can only verify
      // a *literal* template segment (e.g. a template-literal expression)
      // against its generated route union — a plain `string` built by
      // concatenation (as required here) can't be statically matched even
      // though it's a valid, well-formed route at runtime.
      router.replace(target as Href);
    }
  }, [activeRide, pathname]);
}

function RootNavigator() {
  const { isBootstrapping, isAuthenticated, user } = useAuth();
  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold });
  const isReady = !isBootstrapping && fontsLoaded;
  const signedInUserId = isAuthenticated && !isBootstrapping ? user?.id : undefined;
  const onAuthScreen = useSegments()[0] === '(auth)';
  // Notification taps go where the push's payload says — role-aware, see
  // features/notifications/pushRouting.ts — once the session and the
  // navigator are both up.
  usePushTapNavigation({ ready: isReady, userId: signedInUserId, onAuthScreen });
  usePushReceivedInvalidation(signedInUserId);
  useLiveInquiryNotifications(signedInUserId);
  usePushTokenRefresh(isAuthenticated);
  useActiveRideLock(isAuthenticated && !isBootstrapping);
  // Syncs the signed-in user's queued day-of-trip actions wherever they are
  // in the app, not just on that trip's screen.
  useGlobalOfflineQueueFlush(signedInUserId);
  // Stops the driver's background location sharing once their ride is over
  // or the account on this device changes, from wherever they are.
  useDriverLocationReconcile(!isBootstrapping, signedInUserId);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isReady]);

  // Keep the native splash screen up (instead of swapping to a blank/unstyled screen)
  // until fonts are loaded AND session bootstrap resolves — avoids ever flashing a
  // protected screen pre-auth-check or system-font text before Outfit loads.
  if (!isReady) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(public)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="account" />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootNavigator />
            <StatusBar style="auto" />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
