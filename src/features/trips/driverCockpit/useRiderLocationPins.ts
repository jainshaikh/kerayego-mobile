import { useEffect, useState } from 'react';

import { useAppInForeground } from '../../../hooks/useAppInForeground';
import type { TripRiderLocation } from '../../../types/api.types';
import type { TripStatus } from '../../../types/enums';
import { useMyTripRiderLocations } from '../queries';
import { riderLocationsPollWindow } from './riderLocations';

export interface RiderLocationPins {
  riders: TripRiderLocation[];
  // When this device received them (epoch ms) — "x min ago" is measured to
  // here, so it refreshes with every 10 s poll without a ticking clock.
  receivedAt: number;
}

const NO_RIDERS: TripRiderLocation[] = [];

/**
 * The driver's riders' shared positions (GET /my/trips/:id/rider-locations),
 * polled every 10 s while riders still wait for pickup inside their sharing
 * window and the app is in the foreground — none otherwise.
 */
export function useRiderLocationPins(input: {
  tripId: string;
  tripStatus: TripStatus | undefined;
  departureAt: string | undefined;
  ridersAwaitingPickup: boolean;
}): RiderLocationPins {
  const { tripId, tripStatus, departureAt, ridersAwaitingPickup } = input;
  const inForeground = useAppInForeground();
  // Re-evaluated when the window opens or closes by the clock alone.
  const [now, setNow] = useState(() => Date.now());
  const pollWindow = riderLocationsPollWindow({ tripStatus, departureAt, ridersAwaitingPickup, nowMs: now });

  useEffect(() => {
    if (pollWindow.changesInMs === null) return;
    // setTimeout's ceiling is ~24.8 days; a later change is re-checked then.
    const timer = setTimeout(() => setNow(Date.now()), Math.min(pollWindow.changesInMs, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [pollWindow.changesInMs]);

  const enabled = pollWindow.active && inForeground;
  const { data, dataUpdatedAt } = useMyTripRiderLocations(tripId, enabled);
  return { riders: enabled ? (data ?? NO_RIDERS) : NO_RIDERS, receivedAt: dataUpdatedAt };
}
