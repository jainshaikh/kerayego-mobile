import type { ManifestRouteStop } from '../../../api/trips.api';

// Mirrors the backend's NO_SHOW_MIN_WAIT_MINUTES (trips/trip-execution.rules.ts):
// the driver may mark a rider as a no-show only once they have recorded
// Reached at that rider's pickup stop and this long has passed since. The
// server is authoritative — it refuses an early one with a 409 — so this only
// drives the countdown and when the button enables.
export const NO_SHOW_MIN_WAIT_MINUTES = 5;
export const NO_SHOW_MIN_WAIT_MS = NO_SHOW_MIN_WAIT_MINUTES * 60_000;

/**
 * The server's clock as of one manifest fetch: its `serverNow`, and the
 * device time that response arrived (react-query's dataUpdatedAt). Waiting
 * time is measured on the server's clock, so a phone whose clock is wrong
 * still counts the same five minutes; between fetches it is carried forward
 * by how much device time has passed since. The response lands a little after
 * the server stamped serverNow, so the estimate trails by that latency — the
 * button enables a moment late, never early.
 */
export interface ServerClock {
  serverNowMs: number;
  receivedAtMs: number;
}

/** null when the response carried no usable serverNow — an older backend, which has no no-show rules to time. */
export function serverClockFrom(serverNow: string | null | undefined, receivedAtMs: number): ServerClock | null {
  if (!serverNow || !(receivedAtMs > 0)) return null;
  const serverNowMs = Date.parse(serverNow);
  return Number.isFinite(serverNowMs) ? { serverNowMs, receivedAtMs } : null;
}

/** The server's time at device time `deviceNowMs`. A device clock set backwards since the fetch never winds it back. */
export function estimateServerNowMs(clock: ServerClock, deviceNowMs: number): number {
  return clock.serverNowMs + Math.max(0, deviceNowMs - clock.receivedAtMs);
}

/** How long the driver has been at a stop since its server-recorded arrival — null without an arrival or a clock. */
export function waitedAtStopMs(
  arrivedAt: string | null | undefined,
  clock: ServerClock | null,
  deviceNowMs: number,
): number | null {
  if (!arrivedAt || !clock) return null;
  const arrivedAtMs = Date.parse(arrivedAt);
  if (!Number.isFinite(arrivedAtMs)) return null;
  return Math.max(0, estimateServerNowMs(clock, deviceNowMs) - arrivedAtMs);
}

export interface NoShowRider {
  pickupConfirmedAt: string | null;
  droppedOffAt: string | null;
  // Already marked (server noShowAt, or a queued / just-sent NO_SHOW).
  noShow: boolean;
  pickupStop: { id: string } | null;
}

export interface NoShowContext {
  routeStops: readonly Pick<ManifestRouteStop, 'id' | 'arrivedAt'>[];
  // null on an older backend: it would record a no-show without the arrival
  // and wait rules, so the action stays hidden there.
  serverClock: ServerClock | null;
  // Stops whose driver Reached is still waiting in the offline queue — the
  // server hasn't stamped an arrival there yet, so no wait is running.
  queuedArrivalStopIds: ReadonlySet<string>;
}

export type NoShowGate =
  | { state: 'hidden' }
  // Reached here was tapped but hasn't synced: the wait starts once it does.
  | { state: 'arrivalUnsynced' }
  // The wait is running (or over) from this server arrival time.
  | { state: 'timed'; arrivedAtMs: number; clock: ServerClock };

const HIDDEN: NoShowGate = { state: 'hidden' };

/**
 * Whether the driver's "Didn't show" action applies to this rider at all, and
 * what it waits on — the time-independent half of the no-show rule (see
 * noShowRemainingMs for the other half). Only a rider who is still awaiting
 * pickup, has a pickup stop (the server refuses a seat without one), and
 * whose pickup stop has a server-recorded arrival qualifies.
 */
export function noShowGate(rider: NoShowRider, context: NoShowContext): NoShowGate {
  if (!context.serverClock) return HIDDEN;
  if (rider.pickupConfirmedAt || rider.droppedOffAt || rider.noShow || !rider.pickupStop) return HIDDEN;

  const stopId = rider.pickupStop.id;
  const arrivedAt = context.routeStops.find((stop) => stop.id === stopId)?.arrivedAt;
  const arrivedAtMs = arrivedAt ? Date.parse(arrivedAt) : NaN;
  if (!Number.isFinite(arrivedAtMs)) {
    return context.queuedArrivalStopIds.has(stopId) ? { state: 'arrivalUnsynced' } : HIDDEN;
  }
  return { state: 'timed', arrivedAtMs, clock: context.serverClock };
}

/** How much longer (ms) before a no-show may be marked after arriving at `arrivedAtMs` (server time); 0 once it may. */
export function noShowRemainingMs(arrivedAtMs: number, clock: ServerClock, deviceNowMs: number): number {
  return Math.max(0, arrivedAtMs + NO_SHOW_MIN_WAIT_MS - estimateServerNowMs(clock, deviceNowMs));
}

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** A running wait, e.g. "3:07" or "1:02:03" — whole seconds elapsed. */
export function formatElapsed(ms: number): string {
  return formatClock(Math.floor(Math.max(0, ms) / 1000));
}

/** A countdown, e.g. "3:12" — rounded up, so it never reads "0:00" while there is still time left. */
export function formatCountdown(ms: number): string {
  return formatClock(Math.ceil(Math.max(0, ms) / 1000));
}
