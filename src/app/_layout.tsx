import { useEffect } from 'react';
import { Stack, router, usePathname, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit';

import { queryClient } from '../api/query-client';
import { AuthProvider, useAuth } from '../auth/auth-context';
import { configureNotificationHandler, subscribePushTokenRefresh } from '../features/notifications/pushToken';
import { useMyActiveRide } from '../features/trips/queries';

SplashScreen.preventAutoHideAsync().catch(() => {});
configureNotificationHandler();

// Only the rider-facing events map to one specific already-known screen
// (the rider's own request, by inquiryId); a tap on the poster-facing
// "new request" notification just opens the app normally rather than
// guessing a wrong destination — the poster's per-inquiry view lives inside
// a trip we don't have the id for from the push payload alone.
//
// 'chat_message' (Phase 4) is included here too, navigating on the same
// rider-facing target. Its payload carries `tripInquiryId` rather than
// `inquiryId` (see RideRealtimeGateway's chat.message handler) — same kind
// of id, different key name depending on which backend code path produced
// the push — so the handler below reads whichever field is present.
//
// IMPORTANT limitation: a chat push can go to EITHER party — the rider (the
// driver messaged them) or the DRIVER (a rider messaged them) — and the
// payload alone doesn't say which. For a rider recipient this navigation is
// correct. For a driver recipient it is not: the driver's own chat lives on
// my-trips/[id].tsx, keyed by tripId, and a chat push only carries
// tripInquiryId, not tripId, so that route can't be built from this payload
// alone (the exact same "not enough context to deep-link" limitation as the
// poster-facing types noted above). A driver tapping a chat push still lands
// on trip-request/[id] here — TripInquiriesService.findOne does authorize
// the trip's poster to fetch that inquiry, so it won't error, but the screen
// itself is built for the rider's perspective (e.g. a "cancel my seat"
// button), which is a poor fit for a driver. Left as-is for this phase; a
// driver can still open the same chat manually from their manifest row.
// 'trip.*' types (Phase 6) all carry `tripInquiryId` in their push data
// (each rider's own inquiry id) alongside `tripId`, so the same
// inquiryId-fallback read below covers them without any special-casing.
const RIDER_FACING_TYPES = new Set([
  'tripInquiry.accepted',
  'tripInquiry.rejected',
  'tripInquiry.cancelled',
  'chat_message',
  'trip.started',
  'trip.driverArrived',
  'trip.droppedOff',
  'trip.nextPickupApproaching',
  'trip.completed',
]);

function useNotificationTapNavigation() {
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { type?: string; inquiryId?: string; tripInquiryId?: string }
        | undefined;
      const inquiryId = data?.inquiryId ?? data?.tripInquiryId;
      if (data?.type && RIDER_FACING_TYPES.has(data.type) && inquiryId) {
        router.push(`/account/trip-request/${inquiryId}`);
      }
    });
    return () => subscription.remove();
  }, []);
}

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
    if (!activeRide) return;
    const target =
      activeRide.role === 'driver'
        ? '/account/my-trips/' + activeRide.tripId
        : '/account/trip-request/' + activeRide.tripInquiryId;
    // Only replace() when we're not already there — otherwise every refetch
    // (this polls every 20s) would re-trigger a navigation and this becomes
    // a redirect loop instead of a one-time lock-in.
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
  const { isBootstrapping, isAuthenticated } = useAuth();
  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold });
  const isReady = !isBootstrapping && fontsLoaded;
  useNotificationTapNavigation();
  usePushTokenRefresh(isAuthenticated);
  useActiveRideLock(isAuthenticated && !isBootstrapping);

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
