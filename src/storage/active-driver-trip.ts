import AsyncStorage from '@react-native-async-storage/async-storage';

// The one trip whose driver location the background location task
// (features/liveRide/backgroundLocation) is sharing, if any. Persisted, not
// in-memory: the task is a native registration that outlives the JS runtime
// that started it (the OS restores it on the next launch), and this record is
// its only way to know which trip to report for — and whose trip it is, so a
// different account signing in on this device never reports under the wrong
// session. AsyncStorage rather than SecureStore: nothing secret here, and its
// files stay readable on a locked iPhone (after the first unlock), where the
// task keeps running.
const ACTIVE_DRIVER_TRIP_KEY = 'liveRide.activeDriverTrip';

export interface ActiveDriverTrip {
  tripId: string;
  // The driver who started sharing — the signed-in user at the time.
  userId: string;
  // When sharing started on this device (epoch ms, device clock).
  startedAt: number;
}

// Version tag of the stored shape — a record without it (or with another
// version) is unreadable and treated as absent.
const STORE_VERSION = 1;

interface StoredActiveDriverTrip extends ActiveDriverTrip {
  v: typeof STORE_VERSION;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Parses the stored record — `null` when absent, corrupt, or of an unknown shape. */
export function parseActiveDriverTrip(raw: string | null): ActiveDriverTrip | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Partial<StoredActiveDriverTrip>;
  if (record.v !== STORE_VERSION) return null;
  if (!isNonEmptyString(record.tripId) || !isNonEmptyString(record.userId)) return null;
  if (typeof record.startedAt !== 'number' || !Number.isFinite(record.startedAt)) return null;
  return { tripId: record.tripId, userId: record.userId, startedAt: record.startedAt };
}

export async function readActiveDriverTrip(): Promise<ActiveDriverTrip | null> {
  return parseActiveDriverTrip(await AsyncStorage.getItem(ACTIVE_DRIVER_TRIP_KEY));
}

export async function writeActiveDriverTrip(trip: ActiveDriverTrip): Promise<void> {
  const stored: StoredActiveDriverTrip = { v: STORE_VERSION, ...trip };
  await AsyncStorage.setItem(ACTIVE_DRIVER_TRIP_KEY, JSON.stringify(stored));
}

export async function clearActiveDriverTrip(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_DRIVER_TRIP_KEY);
}
