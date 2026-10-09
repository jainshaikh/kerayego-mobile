import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiErrorKind } from '../api/errors';
import type { RecordTripEventPayload } from '../api/trips.api';
import type { TripEventType } from '../types/enums';

// One shared queue for all trips and all accounts on this device — a driver
// only ever runs one trip at a time, but this stays correct even if that ever
// changes. Persisted (not in-memory) so a queued action survives the app being
// killed with no signal — it flushes the next time the app opens (see
// features/trips/offlineSync.ts). Every item belongs to the user who created
// it: reads are scoped to one user, and nothing is ever replayed under
// another account's session.
const QUEUE_KEY = 'trips.offlineQueue';
// Actions that were discarded instead of synced, kept so the trip screen can
// tell the user (a dismissible notice) even when the drop happened while that
// screen wasn't open.
const DROPPED_KEY = 'trips.offlineQueue.dropped';

// Retention (owner decision): an action that hasn't synced within 24 h, or
// that has failed 20 counted attempts, is discarded and reported.
export const OFFLINE_QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_QUEUE_MAX_ATTEMPTS = 20;

// A failed replay only counts toward OFFLINE_QUEUE_MAX_ATTEMPTS once its
// backoff window has passed — 15 s, doubling, capped at 1 h — so a phone that
// is simply offline (and retried every 15 s) spends its 20 attempts over
// ~12 h of continuous failure rather than in five minutes.
const RETRY_BASE_DELAY_MS = 15_000;
const RETRY_MAX_DELAY_MS = 60 * 60 * 1000;

const DROPPED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DROPPED_MAX_ENTRIES = 50;

/** What a screen hands the queue: one action, before it's stamped with its owner. */
export type TripActionDraft =
  | { id: string; kind: 'start'; tripId: string; createdAt: string }
  | { id: string; kind: 'end'; tripId: string; createdAt: string }
  // createdAt is the tap time — the same instant as payload.occurredAt.
  | { id: string; kind: 'event'; tripId: string; createdAt: string; payload: RecordTripEventPayload };

interface QueuedActionMeta {
  v: 2;
  userId: string;
  // Counted failed replays (see RETRY_BASE_DELAY_MS) and the last one's time.
  attemptCount: number;
  lastAttemptAt?: string;
  lastErrorKind?: ApiErrorKind;
}

export type QueuedTripAction = TripActionDraft & QueuedActionMeta;

export type DropReason = 'expired' | 'max_attempts' | 'rejected';

export interface DroppedTripAction {
  id: string;
  tripId: string;
  userId: string;
  kind: TripActionDraft['kind'];
  eventType: TripEventType | null;
  tripInquiryId: string | null;
  reason: DropReason;
  // The server's own message for a 'rejected' action; null otherwise.
  message: string | null;
  droppedAt: string;
}

export function createQueuedAction(draft: TripActionDraft, userId: string): QueuedTripAction {
  return { ...draft, v: 2, userId, attemptCount: 0 };
}

// ─── Retention policy (pure) ─────────────────────────────────────────────────

/** An unparseable timestamp counts as expired — it can't be shown to be fresh. */
export function isExpired(createdAt: string, nowMs: number): boolean {
  const created = Date.parse(createdAt);
  return !Number.isFinite(created) || nowMs - created > OFFLINE_QUEUE_TTL_MS;
}

/** How long after the last counted failure the next one may count. */
export function retryDelayMs(attemptCount: number): number {
  if (attemptCount <= 0) return 0;
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attemptCount - 1), RETRY_MAX_DELAY_MS);
}

export function shouldCountAttempt(action: QueuedTripAction, nowMs: number): boolean {
  if (!action.lastAttemptAt) return true;
  const last = Date.parse(action.lastAttemptAt);
  return !Number.isFinite(last) || nowMs - last >= retryDelayMs(action.attemptCount);
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

type WithoutCreatedAt<T> = T extends unknown ? Omit<T, 'createdAt'> : never;

// Written before items carried an owner: {id, kind, tripId, queuedAt[, payload]}.
type LegacyQueuedTripAction = WithoutCreatedAt<TripActionDraft> & { queuedAt: string };

type StoredEntry = { type: 'current'; action: QueuedTripAction } | { type: 'legacy'; action: LegacyQueuedTripAction };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasActionShape(raw: Record<string, unknown>): boolean {
  if (typeof raw.id !== 'string' || typeof raw.tripId !== 'string') return false;
  if (raw.kind === 'start' || raw.kind === 'end') return true;
  if (raw.kind !== 'event' || !isRecord(raw.payload)) return false;
  return typeof raw.payload.id === 'string' && typeof raw.payload.type === 'string';
}

function parseEntry(raw: unknown): StoredEntry | null {
  if (!isRecord(raw) || !hasActionShape(raw)) return null;
  if (raw.v === 2 && typeof raw.userId === 'string' && typeof raw.createdAt === 'string') {
    const attemptCount = typeof raw.attemptCount === 'number' && raw.attemptCount >= 0 ? raw.attemptCount : 0;
    return { type: 'current', action: { ...(raw as unknown as QueuedTripAction), attemptCount } };
  }
  if (raw.v === undefined && typeof raw.queuedAt === 'string') {
    return { type: 'legacy', action: raw as unknown as LegacyQueuedTripAction };
  }
  return null;
}

async function readArray(key: string): Promise<unknown[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readEntries(): Promise<StoredEntry[]> {
  return (await readArray(QUEUE_KEY)).map(parseEntry).filter((entry): entry is StoredEntry => entry !== null);
}

// Unparseable entries are dropped on the next write — nothing could ever
// replay them. Legacy entries are written back untouched until a signed-in
// read adopts them (migrateLegacyActions).
async function writeEntries(entries: StoredEntry[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(entries.map((entry) => entry.action)));
}

function toDropped(
  action: TripActionDraft & { userId: string },
  reason: DropReason,
  message: string | null,
  nowMs: number,
): DroppedTripAction {
  return {
    id: action.id,
    tripId: action.tripId,
    userId: action.userId,
    kind: action.kind,
    eventType: action.kind === 'event' ? action.payload.type : null,
    tripInquiryId: action.kind === 'event' ? (action.payload.tripInquiryId ?? null) : null,
    reason,
    message,
    droppedAt: new Date(nowMs).toISOString(),
  };
}

function isDroppedAction(raw: unknown): raw is DroppedTripAction {
  return (
    isRecord(raw) &&
    typeof raw.id === 'string' &&
    typeof raw.tripId === 'string' &&
    typeof raw.userId === 'string' &&
    typeof raw.droppedAt === 'string'
  );
}

async function readDropped(nowMs: number): Promise<DroppedTripAction[]> {
  return (await readArray(DROPPED_KEY))
    .filter(isDroppedAction)
    .filter((entry) => nowMs - Date.parse(entry.droppedAt) <= DROPPED_RETENTION_MS);
}

// ─── Lock + change notifications ─────────────────────────────────────────────

// Every read-modify-write of either key runs through this one promise chain,
// so a tap's enqueue and a flush's remove (or two flushes) can't each read the
// same list and have the later write silently undo the earlier one. Plain
// reads skip it — a single getItem is already a consistent snapshot.
let lockTail: Promise<void> = Promise.resolve();

function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lockTail.then(task);
  lockTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const changeListeners = new Set<() => void>();

/** Notified after every write to the queue or the dropped log. */
export function subscribeQueueChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notifyChange(): void {
  changeListeners.forEach((listener) => listener());
}

async function appendDroppedLocked(entries: DroppedTripAction[], nowMs: number): Promise<void> {
  if (!entries.length) return;
  const log = [...(await readDropped(nowMs)), ...entries].slice(-DROPPED_MAX_ENTRIES);
  await AsyncStorage.setItem(DROPPED_KEY, JSON.stringify(log));
}

// ─── Reads (always scoped to one user) ───────────────────────────────────────

// Items queued before they carried an owner are handed to the first signed-in
// user who reads the queue (still within the TTL — older ones are discarded
// and reported). The backend refuses a replay from anyone who isn't the
// action's real actor, so a wrong guess can't apply anything.
async function migrateLegacyActions(userId: string, nowMs: number): Promise<void> {
  const changed = await withQueueLock(async () => {
    const entries = await readEntries();
    if (!entries.some((entry) => entry.type === 'legacy')) return false;

    const dropped: DroppedTripAction[] = [];
    const migrated: StoredEntry[] = [];
    for (const entry of entries) {
      if (entry.type === 'current') {
        migrated.push(entry);
        continue;
      }
      const { queuedAt, ...rest } = entry.action;
      const adopted = createQueuedAction({ ...rest, createdAt: queuedAt } as TripActionDraft, userId);
      if (isExpired(queuedAt, nowMs)) {
        dropped.push(toDropped(adopted, 'expired', null, nowMs));
      } else {
        migrated.push({ type: 'current', action: adopted });
      }
    }
    await writeEntries(migrated);
    await appendDroppedLocked(dropped, nowMs);
    return true;
  });
  if (changed) notifyChange();
}

/** This user's queued actions, in FIFO order (all trips). */
export async function getQueuedActionsForUser(userId: string, nowMs = Date.now()): Promise<QueuedTripAction[]> {
  let entries = await readEntries();
  if (entries.some((entry) => entry.type === 'legacy')) {
    await migrateLegacyActions(userId, nowMs);
    entries = await readEntries();
  }
  return entries.flatMap((entry) => (entry.type === 'current' && entry.action.userId === userId ? [entry.action] : []));
}

/** This user's queued actions for one trip, in FIFO order. */
export async function getQueuedActionsForTrip(
  tripId: string,
  userId: string,
  nowMs = Date.now(),
): Promise<QueuedTripAction[]> {
  return (await getQueuedActionsForUser(userId, nowMs)).filter((action) => action.tripId === tripId);
}

export async function getDroppedActions(
  userId: string,
  tripId: string,
  nowMs = Date.now(),
): Promise<DroppedTripAction[]> {
  return (await readDropped(nowMs)).filter((entry) => entry.userId === userId && entry.tripId === tripId);
}

// ─── Writes (all under the lock) ─────────────────────────────────────────────

// Enqueueing an id that's already queued is a no-op — the same tap is never
// replayed twice.
export async function enqueueTripAction(action: QueuedTripAction): Promise<void> {
  await withQueueLock(async () => {
    const entries = await readEntries();
    if (entries.some((entry) => entry.action.id === action.id)) return;
    await writeEntries([...entries, { type: 'current', action }]);
  });
  notifyChange();
}

// Safe to call with an id that's already gone (e.g. two flush attempts racing) —
// filtering a missing id is a no-op, not an error.
export async function removeQueuedAction(id: string): Promise<void> {
  await withQueueLock(async () => {
    const entries = await readEntries();
    await writeEntries(entries.filter((entry) => entry.action.id !== id));
  });
  notifyChange();
}

/**
 * Records a replay that failed for a transient reason. The failure counts
 * toward OFFLINE_QUEUE_MAX_ATTEMPTS only once its backoff window has passed
 * (shouldCountAttempt); lastErrorKind is always updated. Resolves with the
 * updated action, or null if it's no longer queued.
 */
export async function recordFailedAttempt(
  id: string,
  errorKind: ApiErrorKind,
  nowMs = Date.now(),
): Promise<QueuedTripAction | null> {
  const updated = await withQueueLock(async (): Promise<QueuedTripAction | null> => {
    const entries = await readEntries();
    const index = entries.findIndex((entry) => entry.type === 'current' && entry.action.id === id);
    const entry = entries[index];
    if (!entry || entry.type !== 'current') return null;

    const counted = shouldCountAttempt(entry.action, nowMs);
    const action: QueuedTripAction = {
      ...entry.action,
      lastErrorKind: errorKind,
      ...(counted
        ? { attemptCount: entry.action.attemptCount + 1, lastAttemptAt: new Date(nowMs).toISOString() }
        : null),
    };
    await writeEntries(
      entries.map((existing, i): StoredEntry => (i === index ? { type: 'current', action } : existing)),
    );
    return action;
  });
  if (updated) notifyChange();
  return updated;
}

/** Removes the action and records it in the dropped log, atomically. */
export async function dropQueuedAction(
  action: QueuedTripAction,
  reason: DropReason,
  message: string | null,
  nowMs = Date.now(),
): Promise<DroppedTripAction> {
  const dropped = toDropped(action, reason, message, nowMs);
  await withQueueLock(async () => {
    const entries = await readEntries();
    await writeEntries(entries.filter((entry) => entry.action.id !== action.id));
    await appendDroppedLocked([dropped], nowMs);
  });
  notifyChange();
  return dropped;
}

/**
 * Discards every action — any user's — older than the TTL or out of
 * attempts, and records each in the dropped log for its own user. Resolves
 * with what was dropped.
 */
export async function pruneQueue(nowMs = Date.now()): Promise<DroppedTripAction[]> {
  const dropped = await withQueueLock(async () => {
    const entries = await readEntries();
    const kept: StoredEntry[] = [];
    const removed: DroppedTripAction[] = [];
    for (const entry of entries) {
      if (entry.type !== 'current') {
        kept.push(entry);
      } else if (isExpired(entry.action.createdAt, nowMs)) {
        removed.push(toDropped(entry.action, 'expired', null, nowMs));
      } else if (entry.action.attemptCount >= OFFLINE_QUEUE_MAX_ATTEMPTS) {
        removed.push(toDropped(entry.action, 'max_attempts', null, nowMs));
      } else {
        kept.push(entry);
      }
    }
    if (removed.length) {
      await writeEntries(kept);
      await appendDroppedLocked(removed, nowMs);
    }
    return removed;
  });
  if (dropped.length) notifyChange();
  return dropped;
}

export async function dismissDroppedActions(userId: string, tripId: string, nowMs = Date.now()): Promise<void> {
  await withQueueLock(async () => {
    const log = await readDropped(nowMs);
    await AsyncStorage.setItem(
      DROPPED_KEY,
      JSON.stringify(log.filter((entry) => entry.userId !== userId || entry.tripId !== tripId)),
    );
  });
  notifyChange();
}
