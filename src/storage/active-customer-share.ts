import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LocationShareTargetKind } from '../types/api.types';

// The one sharing window whose customer location the customer background
// location task (features/liveRide/backgroundLocation/customerLocationSharing.ts)
// is posting for, if any — a carpool seat or a rental booking. Persisted for
// the same reasons as active-driver-trip.ts: the task is a native
// registration that outlives the JS runtime that started it, and this record
// is its only way to know what to report for and whose it is.
const ACTIVE_CUSTOMER_SHARE_KEY = 'liveRide.activeCustomerShare';

export interface ActiveCustomerShare {
  kind: LocationShareTargetKind;
  // tripInquiryId or bookingRequestId.
  id: string;
  // The customer who started sharing — the signed-in user at the time.
  userId: string;
  // When sharing started on this device (epoch ms, device clock).
  startedAt: number;
}

const STORE_VERSION = 1;

interface StoredActiveCustomerShare extends ActiveCustomerShare {
  v: typeof STORE_VERSION;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Parses the stored record — `null` when absent, corrupt, or of an unknown shape. */
export function parseActiveCustomerShare(raw: string | null): ActiveCustomerShare | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Partial<StoredActiveCustomerShare>;
  if (record.v !== STORE_VERSION) return null;
  if (record.kind !== 'TRIP_INQUIRY' && record.kind !== 'BOOKING') return null;
  if (!isNonEmptyString(record.id) || !isNonEmptyString(record.userId)) return null;
  if (typeof record.startedAt !== 'number' || !Number.isFinite(record.startedAt)) return null;
  return { kind: record.kind, id: record.id, userId: record.userId, startedAt: record.startedAt };
}

export async function readActiveCustomerShare(): Promise<ActiveCustomerShare | null> {
  return parseActiveCustomerShare(await AsyncStorage.getItem(ACTIVE_CUSTOMER_SHARE_KEY));
}

export async function writeActiveCustomerShare(share: ActiveCustomerShare): Promise<void> {
  const stored: StoredActiveCustomerShare = { v: STORE_VERSION, ...share };
  await AsyncStorage.setItem(ACTIVE_CUSTOMER_SHARE_KEY, JSON.stringify(stored));
}

export async function clearActiveCustomerShare(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_CUSTOMER_SHARE_KEY);
}
