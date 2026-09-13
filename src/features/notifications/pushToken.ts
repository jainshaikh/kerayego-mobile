import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { deviceTokensApi } from '../../api/device-tokens.api';

// Foreground notifications are silent by default in expo-notifications —
// without a handler, a push that arrives while the app is open never shows
// anything at all. Call this once at app startup, before any push could
// possibly arrive.
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Best-effort on both ends — a user who denies the permission prompt, or a
// device that can't produce a token for some reason, should never block
// login/app-start. Call after a successful login and after a bootstrap-
// restored session, so a token gets (re-)registered on every real session
// start without needing its own UI.
export async function registerPushToken(): Promise<void> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const { data: token } = await Notifications.getDevicePushTokenAsync();
    await deviceTokensApi.register(token, Platform.OS === 'ios' ? 'IOS' : 'ANDROID');
  } catch (err) {
    console.warn('[pushToken] failed to register for push notifications:', err);
  }
}

// Play Services can reissue a device's FCM token at any point during an
// app's lifetime, not just on reinstall — without this, a rotated token
// leaves the old (now-dead) one sitting in the backend forever and no push
// ever arrives again until the next login. Subscribe once while a session
// is active; caller owns tearing it down (e.g. on logout).
export function subscribePushTokenRefresh(): () => void {
  const subscription = Notifications.addPushTokenListener((token) => {
    deviceTokensApi
      .register(token.data, Platform.OS === 'ios' ? 'IOS' : 'ANDROID')
      .catch((err) => console.warn('[pushToken] failed to re-register refreshed push token:', err));
  });
  return () => subscription.remove();
}

// Called before clearing the local session on logout — the backend call
// needs to happen while the about-to-expire access token is still valid, so
// this must run before, not after, the session is actually cleared.
export async function unregisterPushToken(): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    await deviceTokensApi.unregister(token);
  } catch (err) {
    console.warn('[pushToken] failed to unregister push token:', err);
  }
}
