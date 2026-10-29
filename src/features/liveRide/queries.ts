import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { locationSharingApi, type LocationShareTargetRef } from '../../api/location-sharing.api';
import { normalizeApiError } from '../../api/errors';
import type { MyLocationSharing } from '../../types/api.types';
import { LOCATION_SHARING_POLL_MS, sameShareTarget } from './backgroundLocation/customerLocationRules';
import {
  clearCustomerTargetBlock,
  stopCustomerLocationSharingFor,
} from './backgroundLocation/customerLocationSharing';

export const MY_LOCATION_SHARING_KEY = ['myLocationSharing'] as const;

/**
 * GET /users/me/location-sharing — the customer's open sharing windows. One
 * query for the whole app: the reconcile (useCustomerLocationReconcile) polls
 * it every 60 s while `poll` (signed in, app in the foreground), and the
 * sharing cards on the ride/booking screens read the same cache.
 */
export function useMyLocationSharing(enabled: boolean, poll = false) {
  return useQuery({
    queryKey: MY_LOCATION_SHARING_KEY,
    queryFn: () => locationSharingApi.getMine(),
    enabled,
    staleTime: 0,
    refetchInterval: enabled && poll ? LOCATION_SHARING_POLL_MS : false,
  });
}

/**
 * Stop (paused: true) / Resume (paused: false) sharing for one window. The
 * cache is updated straight from the answer — after cancelling a poll that
 * left before it, so an older "paused" can't land on top of a Resume — and
 * Stop also ends the task on this device at once.
 */
export function useSetLocationSharingPaused() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ target, paused }: { target: LocationShareTargetRef; paused: boolean }) =>
      locationSharingApi.setPaused(target, paused),
    onSuccess: async (result, { target }) => {
      await queryClient.cancelQueries({ queryKey: MY_LOCATION_SHARING_KEY });
      queryClient.setQueryData<MyLocationSharing>(MY_LOCATION_SHARING_KEY, (current) =>
        current
          ? {
              ...current,
              targets: current.targets.map((t) => (sameShareTarget(t, target) ? { ...t, paused: result.paused } : t)),
            }
          : current,
      );
      if (result.paused) await stopCustomerLocationSharingFor(target, 'paused');
      else clearCustomerTargetBlock(target);
    },
    // 409 LOCATION_SHARING_CLOSED (the seat is no longer ACCEPTED, the
    // booking no longer ACCEPTED/IN_PROGRESS) or 404: the window list is
    // stale — re-check it, which also drops the card.
    onError: (error) => {
      const kind = normalizeApiError(error).kind;
      if (kind === 'conflict' || kind === 'not_found') {
        void queryClient.invalidateQueries({ queryKey: MY_LOCATION_SHARING_KEY });
      }
    },
  });
}
