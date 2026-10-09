import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// An in-memory keychain that behaves like iOS's for what matters here: an
// item keeps the accessibility it was CREATED with — writing a new value to
// an existing key only replaces the value (expo-secure-store's update path).
interface MockKeychainItem {
  value: string;
  keychainAccessible: number | undefined;
}
const mockKeychain = new Map<string, MockKeychainItem>();
const mockDeleteItemAsync = jest.fn(async (key: string): Promise<void> => {
  mockKeychain.delete(key);
});

// The factory re-runs after every jest.resetModules() below; it only
// delegates, so the keychain and the delete spy stay the same objects.
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 1,
  getItemAsync: async (key: string) => mockKeychain.get(key)?.value ?? null,
  setItemAsync: async (key: string, value: string, options?: { keychainAccessible?: number }) => {
    const existing = mockKeychain.get(key);
    mockKeychain.set(key, {
      value,
      keychainAccessible: existing ? existing.keychainAccessible : options?.keychainAccessible,
    });
  },
  deleteItemAsync: (key: string) => mockDeleteItemAsync(key),
}));

// The mocked SecureStore.AFTER_FIRST_UNLOCK.
const AFTER_FIRST_UNLOCK = 1;

const NEW_KEY = 'auth.refreshToken.v2';
const LEGACY_KEY = 'auth.refreshToken';

// A fresh copy of the module per test — it remembers, per app run, that the
// pre-migration copy is gone.
async function loadSecureStorage() {
  jest.resetModules();
  // requireActual only skips mocking for this module itself — its own
  // expo-secure-store import still gets the mock above.
  return jest.requireActual<typeof import('./secure-storage')>('./secure-storage');
}

beforeEach(() => {
  mockKeychain.clear();
  mockDeleteItemAsync.mockClear();
});

describe('refresh token storage', () => {
  it('stores the token readable after first unlock (for the background location task on a locked phone)', async () => {
    const storage = await loadSecureStorage();
    await storage.setRefreshToken('rt-1');
    expect(mockKeychain.get(NEW_KEY)).toEqual({ value: 'rt-1', keychainAccessible: AFTER_FIRST_UNLOCK });
    await expect(storage.getRefreshToken()).resolves.toBe('rt-1');
  });

  it('still reads a token stored before the migration', async () => {
    mockKeychain.set(LEGACY_KEY, { value: 'rt-old', keychainAccessible: undefined });
    const storage = await loadSecureStorage();
    await expect(storage.getRefreshToken()).resolves.toBe('rt-old');
  });

  it('migrates on the next write: new item first, then the old WHEN_UNLOCKED one is removed', async () => {
    mockKeychain.set(LEGACY_KEY, { value: 'rt-old', keychainAccessible: undefined });
    const storage = await loadSecureStorage();
    await storage.setRefreshToken('rt-new');

    expect(mockKeychain.has(LEGACY_KEY)).toBe(false);
    expect(mockKeychain.get(NEW_KEY)).toEqual({ value: 'rt-new', keychainAccessible: AFTER_FIRST_UNLOCK });
    await expect(storage.getRefreshToken()).resolves.toBe('rt-new');
  });

  it('prefers the new key over a leftover old one', async () => {
    mockKeychain.set(LEGACY_KEY, { value: 'rt-old', keychainAccessible: undefined });
    mockKeychain.set(NEW_KEY, { value: 'rt-new', keychainAccessible: AFTER_FIRST_UNLOCK });
    const storage = await loadSecureStorage();
    await expect(storage.getRefreshToken()).resolves.toBe('rt-new');
  });

  it('rotations keep the accessibility and stop deleting the old key once it is gone', async () => {
    const storage = await loadSecureStorage();
    await storage.setRefreshToken('rt-1');
    await storage.setRefreshToken('rt-2');
    await storage.setRefreshToken('rt-3');
    expect(mockKeychain.get(NEW_KEY)).toEqual({ value: 'rt-3', keychainAccessible: AFTER_FIRST_UNLOCK });
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('a failed removal of the old copy never fails the write, and is retried next time', async () => {
    mockKeychain.set(LEGACY_KEY, { value: 'rt-old', keychainAccessible: undefined });
    const storage = await loadSecureStorage();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDeleteItemAsync.mockRejectedValueOnce(new Error('keychain busy'));

    await expect(storage.setRefreshToken('rt-1')).resolves.toBeUndefined();
    warn.mockRestore();
    expect(mockKeychain.has(LEGACY_KEY)).toBe(true);

    await storage.setRefreshToken('rt-2');
    expect(mockKeychain.has(LEGACY_KEY)).toBe(false);
  });

  it('clearing removes both copies', async () => {
    mockKeychain.set(LEGACY_KEY, { value: 'rt-old', keychainAccessible: undefined });
    mockKeychain.set(NEW_KEY, { value: 'rt-new', keychainAccessible: AFTER_FIRST_UNLOCK });
    const storage = await loadSecureStorage();
    await storage.clearAllAuthStorage();
    await expect(storage.getRefreshToken()).resolves.toBeNull();
    expect(mockKeychain.size).toBe(0);
  });
});
