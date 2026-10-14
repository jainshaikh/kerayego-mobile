import { isRiderDoneAtStop, type StopResolution } from './stopProgress';

/**
 * The driver's leg-by-leg progress through the route. Stops are worked
 * through one at a time in visit order (pickups, then drop-offs — the
 * manifest's routeStops order):
 *
 *   upcoming → current (navigating to it) → current (arrived, verifying its
 *   riders) → done (left with "Start next leg")
 *
 * A stop the driver never arrived at whose riders all need nothing more
 * there already (a cancelled seat, an early drop-off, a no-show at pickup)
 * is skipped automatically. The current stop is the first one neither done
 * nor skipped.
 *
 * Mirrors the backend's findCurrentStopId (trips/trip-execution.rules.ts) —
 * derived here too so the cockpit moves on immediately, including for taps
 * still queued offline. Keep the two in step.
 */
export type LegPhase =
  // Heading to the current stop — the map shows the route there.
  | 'navigating'
  // Arrived at the current stop — navigation paused while its riders are verified.
  | 'atStop'
  // Every stop is behind the driver — only End ride is left.
  | 'done';

export type StopLegStatus = 'done' | 'skipped' | 'current' | 'upcoming';

export interface LegStop extends StopResolution {
  // 0-based position in visit order.
  index: number;
  arrived: boolean;
  departed: boolean;
  status: StopLegStatus;
}

export interface LegState {
  phase: LegPhase;
  // Every route stop, in visit order, with its status.
  stops: LegStop[];
  current: LegStop | null;
  // Where "Start next leg" goes from the current stop: the next stop that
  // won't be skipped. Null at the last one — End ride takes its place.
  next: LegStop | null;
  // Riders at the current stop that need nothing more there, of current.riders.length.
  verifiedCount: number;
  // Arrived at the current stop and every rider there is verified.
  canStartNextLeg: boolean;
}

export function deriveLegState(
  resolutions: readonly StopResolution[],
  arrivedStopIds: ReadonlySet<string>,
  departedStopIds: ReadonlySet<string>,
): LegState {
  const marked = resolutions.map((resolution, index) => ({
    ...resolution,
    index,
    arrived: arrivedStopIds.has(resolution.stop.id),
    departed: departedStopIds.has(resolution.stop.id),
  }));
  const skippable = (stop: (typeof marked)[number]) => !stop.arrived && stop.resolved;
  const currentIndex = marked.findIndex((stop) => !stop.departed && !skippable(stop));

  const stops: LegStop[] = marked.map((stop) => ({
    ...stop,
    status:
      stop.index === currentIndex ? 'current' : stop.departed ? 'done' : skippable(stop) ? 'skipped' : 'upcoming',
  }));

  const current = currentIndex === -1 ? null : stops[currentIndex];
  const next = current ? (stops.slice(current.index + 1).find((stop) => stop.status === 'upcoming') ?? null) : null;
  const phase: LegPhase = !current ? 'done' : current.arrived ? 'atStop' : 'navigating';

  return {
    phase,
    stops,
    current,
    next,
    verifiedCount: current ? current.riders.filter((rider) => isRiderDoneAtStop(rider, current.stop.type)).length : 0,
    canStartNextLeg: phase === 'atStop' && !!current?.resolved,
  };
}
