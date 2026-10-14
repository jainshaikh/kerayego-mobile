import type { CockpitRider } from './stopProgress';

export type RiderOutcome = 'completed' | 'noShow';

export interface RideSummaryRider {
  rider: CockpitRider;
  outcome: RiderOutcome;
}

export interface RideSummary {
  riders: RideSummaryRider[];
  completedCount: number;
  noShowCount: number;
  // Seats actually travelled — a no-show's seats earned nothing.
  seats: number;
}

/**
 * How the ride went, for the driver's post-ride summary. Ending the ride
 * completes every rider the driver hadn't tapped through (the backend's
 * AUTO_ON_TRIP_END), so every rider is either completed or a no-show.
 */
export function summarizeRide(riders: readonly CockpitRider[]): RideSummary {
  const summaryRiders = riders.map((rider) => ({
    rider,
    outcome: (rider.noShow ? 'noShow' : 'completed') as RiderOutcome,
  }));
  const completed = summaryRiders.filter((r) => r.outcome === 'completed');
  return {
    riders: summaryRiders,
    completedCount: completed.length,
    noShowCount: summaryRiders.length - completed.length,
    seats: completed.reduce((sum, r) => sum + r.rider.requestedSeats, 0),
  };
}
