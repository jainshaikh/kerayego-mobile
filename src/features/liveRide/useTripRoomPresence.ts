import { useEffect } from 'react';
import { useRideSocket } from './socket';

/**
 * Joins the live-ride socket room for a trip once the shared socket is ready
 * (which may not be the case yet on first mount), and leaves it again as soon
 * as `active` turns false or the calling screen unmounts. Shared by the
 * driver cockpit and the rider live view — both join the same per-trip room;
 * only the driver additionally emits location into it.
 */
export function useTripRoomPresence(tripId: string | undefined, active: boolean): void {
  const { isReady, joinTrip, leaveTrip } = useRideSocket();

  useEffect(() => {
    if (!active || !isReady || !tripId) return;

    let cancelled = false;
    joinTrip(tripId).then((result) => {
      if (!cancelled && !result.ok) {
        console.warn('[LiveRide] joinTrip failed:', result.error);
      }
    });

    return () => {
      cancelled = true;
      leaveTrip(tripId);
    };
    // joinTrip/leaveTrip omitted deliberately: useRideSocket() returns a new
    // function identity every render (it reads live module state, not a
    // stale closure), so including them would tear down/rejoin the room on
    // every render instead of only when active/isReady/tripId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isReady, tripId]);
}
