import type { ManifestRider, ManifestRouteStop } from '../../../api/trips.api';
import { PickupSource } from '../../../types/enums';
import type { RiderEventOverlay } from '../tripActionOverlay';

/** A manifest rider with the driver's taps the server hasn't reflected yet merged in. */
export interface CockpitRider extends ManifestRider {
  // Marked as a no-show (by the server's noShowAt, or a queued / just-sent
  // NO_SHOW) and not picked up or dropped off since.
  noShow: boolean;
}

export interface StopResolution {
  stop: ManifestRouteStop;
  riders: CockpitRider[];
  resolved: boolean;
  // A drop-off stop whose riders were all no-shows: nobody to drop off there.
  skipped: boolean;
}

interface RiderOverlay {
  riderEvents: Record<string, RiderEventOverlay>;
  noShowIds: ReadonlySet<string>;
}

/**
 * Merges the overlay (see deriveTripActionOverlay) into the manifest's riders.
 * Server values win wherever they're set. A rider is a no-show only while
 * neither picked up nor dropped off — a PICKUP reverses a no-show on the
 * server, and the server refuses a no-show for a rider already picked up, so
 * a pickup on either side outranks a no-show on either side.
 */
export function mergeCockpitRiders(riders: readonly ManifestRider[], overlay: RiderOverlay): CockpitRider[] {
  return riders.map((rider) => {
    const optimistic = overlay.riderEvents[rider.id];
    const pickupConfirmedAt = rider.pickupConfirmedAt ?? optimistic?.pickupConfirmedAt ?? null;
    const droppedOffAt = rider.droppedOffAt ?? optimistic?.droppedOffAt ?? null;
    const noShow = !pickupConfirmedAt && !droppedOffAt && (!!rider.noShowAt || overlay.noShowIds.has(rider.id));
    return {
      ...rider,
      pickupConfirmedAt,
      droppedOffAt,
      pickupSource: rider.pickupSource ?? (optimistic?.pickupConfirmedAt ? PickupSource.DRIVER_TAP : null),
      noShow,
    };
  });
}

/**
 * Whether `rider` needs nothing more at a stop of `stopType`. A no-show needs
 * nothing at either of their stops, and a rider who is already dropped off
 * (e.g. self-reported without a pickup tap) can't be picked up any more —
 * otherwise either would hold their stop as "next" forever, freezing every
 * later stop's Reached button.
 */
export function isRiderDoneAtStop(rider: CockpitRider, stopType: ManifestRouteStop['type']): boolean {
  if (rider.noShow || rider.droppedOffAt) return true;
  return stopType === 'PICKUP' ? !!rider.pickupConfirmedAt : false;
}

/** Each route stop (in visit order) with its riders, and whether everyone there is done. */
export function resolveStops(routeStops: readonly ManifestRouteStop[], riders: readonly CockpitRider[]): StopResolution[] {
  return routeStops.map((stop) => {
    const stopRiders = riders.filter((rider) =>
      stop.type === 'PICKUP' ? rider.pickupStop?.id === stop.id : rider.dropoffStop?.id === stop.id,
    );
    return {
      stop,
      riders: stopRiders,
      resolved: stopRiders.every((rider) => isRiderDoneAtStop(rider, stop.type)),
      skipped: stop.type === 'DROPOFF' && stopRiders.length > 0 && stopRiders.every((rider) => rider.noShow),
    };
  });
}

/** The first stop, in visit order, with unfinished business — null once every stop is resolved. */
export function findNextStop(resolutions: readonly StopResolution[]): ManifestRouteStop | null {
  return resolutions.find((resolution) => !resolution.resolved)?.stop ?? null;
}

/** Stops the driver has reached: recorded by the server (arrivedAt), or queued / just sent from this device. */
export function mergeArrivedStopIds(
  routeStops: readonly ManifestRouteStop[],
  overlayArrivedStopIds: ReadonlySet<string>,
): Set<string> {
  const arrived = new Set(overlayArrivedStopIds);
  routeStops.forEach((stop) => {
    if (stop.arrivedAt) arrived.add(stop.id);
  });
  return arrived;
}
