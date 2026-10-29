import { TripStatus } from '../../../types/enums';

// When the carpool driver's screens ask for their riders' shared positions
// (GET /my/trips/:id/rider-locations) — pure, unit-tested. The backend
// decides whose position comes back; this only keeps the app from polling
// when nobody can be sharing: the riders' windows open 30 min before
// departure and last until pickup (backend constants RIDER_SHARE_LEAD_MIN,
// SHARE_GRACE_AFTER_START_H, hand-copied — there's no shared package).
export const RIDER_SHARE_LEAD_MIN = 30;
export const SHARE_GRACE_AFTER_START_H = 3;
export const RIDER_LOCATIONS_POLL_MS = 10_000;

interface RiderPickupState {
  pickupConfirmedAt: string | null;
  droppedOffAt: string | null;
  noShow?: boolean;
  noShowAt?: string | null;
}

/** Whether any rider still waits to be picked up (not picked up, dropped off or a no-show). */
export function hasRidersAwaitingPickup(riders: readonly RiderPickupState[]): boolean {
  return riders.some((rider) => !rider.pickupConfirmedAt && !rider.droppedOffAt && !rider.noShow && !rider.noShowAt);
}

export interface RiderLocationsPollWindow {
  // Poll now.
  active: boolean;
  // When this answer changes by the clock alone (ms from now), or null.
  changesInMs: number | null;
}

/**
 * Whether to poll riders' positions: while riders wait for pickup and the
 * trip is IN_PROGRESS, or ACTIVE within departure − 30 min … departure + 3 h
 * (the backend's own window for an ACTIVE trip).
 */
export function riderLocationsPollWindow(input: {
  tripStatus: TripStatus | string | undefined;
  departureAt: string | undefined;
  ridersAwaitingPickup: boolean;
  nowMs: number;
}): RiderLocationsPollWindow {
  const { tripStatus, departureAt, ridersAwaitingPickup, nowMs } = input;
  if (!ridersAwaitingPickup) return { active: false, changesInMs: null };
  if (tripStatus === TripStatus.IN_PROGRESS) return { active: true, changesInMs: null };
  if (tripStatus !== TripStatus.ACTIVE || !departureAt) return { active: false, changesInMs: null };
  const departure = Date.parse(departureAt);
  if (!Number.isFinite(departure)) return { active: false, changesInMs: null };
  const opensAt = departure - RIDER_SHARE_LEAD_MIN * 60_000;
  const closesAt = departure + SHARE_GRACE_AFTER_START_H * 60 * 60_000;
  if (nowMs < opensAt) return { active: false, changesInMs: opensAt - nowMs };
  if (nowMs <= closesAt) return { active: true, changesInMs: closesAt - nowMs + 1 };
  return { active: false, changesInMs: null };
}
