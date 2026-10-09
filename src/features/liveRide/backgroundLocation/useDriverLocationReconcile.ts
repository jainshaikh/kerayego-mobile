import { useEffect } from 'react';

import { useMyActiveRide } from '../../trips/queries';
import { reconcileDriverLocationSharing } from './driverLocationSharing';

/**
 * Root-level backstop for background driver location (driverLocationSharing.ts),
 * wherever the driver is in the app: stops sharing once GET /my/active-ride no
 * longer has them driving that trip, when someone else (or nobody) is signed
 * in, or when the OS restored a registration with no trip behind it — e.g.
 * after the app was killed mid-trip and the trip ended meanwhile.
 *
 * `ready`: the session restore is done — until then who's signed in isn't
 * known. Shares the ['myActiveRide'] query (and its 20 s poll) with the
 * active-ride lock.
 */
export function useDriverLocationReconcile(ready: boolean, userId: string | undefined): void {
  const { data: activeRide, dataUpdatedAt } = useMyActiveRide(ready && !!userId);
  const sessionUserId = ready ? (userId ?? null) : undefined;

  useEffect(() => {
    if (sessionUserId === undefined) return;
    void reconcileDriverLocationSharing({
      userId: sessionUserId,
      activeRide: sessionUserId ? activeRide : undefined,
      activeRideFetchedAt: dataUpdatedAt,
    });
  }, [sessionUserId, activeRide, dataUpdatedAt]);
}
