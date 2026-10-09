import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Centralized secure storage keys — access token is intentionally never persisted
// here (kept in memory only, see src/api/client.ts) so it disappears on app kill.
//
// The refresh token lives under a second key since it became readable on a
// locked iPhone (REFRESH_TOKEN_OPTIONS below). A keychain item's
// accessibility can't be changed in place — expo-secure-store only updates
// the value of an item that already exists — so the next write creates the
// new item and only then deletes the old one, never leaving the device
// without a token in between. Reads fall back to the old key until then.
const REFRESH_TOKEN_KEY = 'auth.refreshToken.v2';
const LEGACY_REFRESH_TOKEN_KEY = 'auth.refreshToken';
const AUTH_USER_KEY = 'auth.user';

// iOS: readable from the first unlock after a restart onwards, including
// while the phone is locked — the driver's background location task
// (features/liveRide/backgroundLocation) refreshes its 15-minute access
// token mid-trip, often with the screen locked. The default, WHEN_UNLOCKED,
// fails every such refresh. Nothing else changes: still unreadable until the
// first unlock after a restart, and backed up exactly like the default.
// Android ignores this option.
const REFRESH_TOKEN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

// expo-secure-store has NO web implementation (there's no OS keychain in a browser —
// ExpoSecureStore.web.js literally exports {}), so calling it on web throws
// "... is not a function". This app's real target is native (Expo Go / dev client on
// Android/iOS) per the implementation reference — `expo start --web` is dev-only
// convenience for eyeballing UI. localStorage here is NOT secure storage; it only
// exists so the web preview doesn't hard-crash on every auth call.
const isWeb = Platform.OS === 'web';

async function getItem(key: string): Promise<string | null> {
  if (isWeb) return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, options);
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

// Set once the pre-migration copy is known to be gone, so the token's
// rotation (every refresh) doesn't delete it again each time.
let legacyRefreshTokenRemoved = false;

export async function getRefreshToken(): Promise<string | null> {
  const token = await getItem(REFRESH_TOKEN_KEY);
  if (token !== null) return token;
  return getItem(LEGACY_REFRESH_TOKEN_KEY);
}

export async function setRefreshToken(token: string): Promise<void> {
  await setItem(REFRESH_TOKEN_KEY, token, REFRESH_TOKEN_OPTIONS);
  if (legacyRefreshTokenRemoved) return;
  try {
    await deleteItem(LEGACY_REFRESH_TOKEN_KEY);
    legacyRefreshTokenRemoved = true;
  } catch (err) {
    // Harmless: the new key is read first. Tried again on the next write.
    console.warn('[secureStorage] failed to remove the pre-migration refresh token:', err);
  }
}

export async function clearRefreshToken(): Promise<void> {
  await Promise.all([deleteItem(REFRESH_TOKEN_KEY), deleteItem(LEGACY_REFRESH_TOKEN_KEY)]);
}

export async function getStoredAuthUser<T>(): Promise<T | null> {
  const raw = await getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setStoredAuthUser(user: unknown): Promise<void> {
  await setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export async function clearStoredAuthUser(): Promise<void> {
  await deleteItem(AUTH_USER_KEY);
}

export async function clearAllAuthStorage(): Promise<void> {
  await Promise.all([clearRefreshToken(), clearStoredAuthUser()]);
}
