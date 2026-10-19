import { describe, expect, it } from '@jest/globals';

import type { ManifestRider, ManifestRouteStop } from '../../../api/trips.api';
import { deriveLegState } from './legState';
import { mergeCockpitRiders, resolveStops } from './stopProgress';

const AT = '2026-10-08T09:10:00.000Z';
const LATER = '2026-10-08T09:40:00.000Z';

function stop(id: string, type: ManifestRouteStop['type']): ManifestRouteStop {
  return { id, type, label: id, lat: 24.86, lng: 67.0 };
}

// Visit order as the backend sends it: pickups, then drop-offs.
const P1 = stop('p1', 'PICKUP');
const P2 = stop('p2', 'PICKUP');
const D1 = stop('d1', 'DROPOFF');
const D2 = stop('d2', 'DROPOFF');
const ROUTE = [P1, P2, D1, D2];

function rider(id: string, pickup: ManifestRouteStop, dropoff: ManifestRouteStop, overrides: Partial<ManifestRider> = {}): ManifestRider {
  return {
    id,
    requestedSeats: 1,
    pickupNote: null,
    pickupConfirmedAt: null,
    pickupSource: null,
    droppedOffAt: null,
    noShowAt: null,
    pickupStop: { id: pickup.id, label: pickup.label, lat: pickup.lat, lng: pickup.lng },
    dropoffStop: { id: dropoff.id, label: dropoff.label, lat: dropoff.lat, lng: dropoff.lng },
    user: { id: `user-${id}`, name: id, phone: null },
    ...overrides,
  };
}

// a: p1 → d1, b: p1 → d2, c: p2 → d2.
function riders(overrides: Partial<Record<'a' | 'b' | 'c', Partial<ManifestRider>>> = {}): ManifestRider[] {
  return [rider('a', P1, D1, overrides.a), rider('b', P1, D2, overrides.b), rider('c', P2, D2, overrides.c)];
}

function leg(
  manifestRiders: ManifestRider[],
  { arrived = [] as string[], departed = [] as string[], noShowIds = [] as string[] } = {},
) {
  const merged = mergeCockpitRiders(manifestRiders, { riderEvents: {}, noShowIds: new Set(noShowIds) });
  return deriveLegState(resolveStops(ROUTE, merged), new Set(arrived), new Set(departed));
}

const statuses = (state: ReturnType<typeof leg>) => state.stops.map((s) => s.status);

describe('deriveLegState', () => {
  it('starts navigating to the first pickup stop, with the next leg named', () => {
    const state = leg(riders());
    expect(state).toMatchObject({ phase: 'navigating', canStartNextLeg: false, verifiedCount: 0 });
    expect(state.current?.stop.id).toBe('p1');
    expect(state.next?.stop.id).toBe('p2');
    expect(statuses(state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('pauses at the stop once arrived, verifying its riders one by one', () => {
    const arrived = leg(riders(), { arrived: ['p1'] });
    expect(arrived).toMatchObject({ phase: 'atStop', verifiedCount: 0, canStartNextLeg: false });

    const oneVerified = leg(riders({ a: { pickupConfirmedAt: AT } }), { arrived: ['p1'] });
    expect(oneVerified).toMatchObject({ phase: 'atStop', verifiedCount: 1, canStartNextLeg: false });
  });

  it('offers Start next leg only once every rider at the stop is picked up or a no-show', () => {
    const state = leg(riders({ a: { pickupConfirmedAt: AT }, b: { noShowAt: AT } }), { arrived: ['p1'] });
    expect(state).toMatchObject({ phase: 'atStop', verifiedCount: 2, canStartNextLeg: true });
    // Still the current stop: resolving its riders alone never moves the driver on.
    expect(state.current?.stop.id).toBe('p1');
  });

  it('counts a no-show still only in the overlay (queued offline) as verified', () => {
    const state = leg(riders({ a: { pickupConfirmedAt: AT } }), { arrived: ['p1'], noShowIds: ['b'] });
    expect(state.canStartNextLeg).toBe(true);
  });

  it('moves to the next leg once the driver leaves the stop', () => {
    const state = leg(riders({ a: { pickupConfirmedAt: AT }, b: { pickupConfirmedAt: AT } }), {
      arrived: ['p1'],
      departed: ['p1'],
    });
    expect(state.phase).toBe('navigating');
    expect(state.current?.stop.id).toBe('p2');
    expect(statuses(state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
  });

  it('skips a stop never arrived at whose riders need nothing more there already', () => {
    // Everyone at p1 resolved before the driver got there (a no-show and a rider who self-completed).
    const state = leg(riders({ a: { noShowAt: AT }, b: { droppedOffAt: AT } }));
    expect(state.current?.stop.id).toBe('p2');
    expect(statuses(state)[0]).toBe('skipped');
  });

  it("skips a drop-off stop whose only rider was a no-show, and doesn't offer it as the next leg", () => {
    const state = leg(riders({ a: { noShowAt: AT }, b: { pickupConfirmedAt: AT }, c: { pickupConfirmedAt: AT } }), {
      arrived: ['p1', 'p2'],
      departed: ['p1'],
    });
    expect(state.current?.stop.id).toBe('p2');
    expect(state.next?.stop.id).toBe('d2');
    expect(statuses(state)).toEqual(['done', 'current', 'skipped', 'upcoming']);
  });

  it('has no next leg at the last stop — End ride takes its place', () => {
    const onBoard = { pickupConfirmedAt: AT };
    const state = leg(riders({ a: { ...onBoard, droppedOffAt: LATER }, b: onBoard, c: onBoard }), {
      arrived: ['p1', 'p2', 'd1', 'd2'],
      departed: ['p1', 'p2', 'd1'],
    });
    expect(state.current?.stop.id).toBe('d2');
    expect(state.next).toBeNull();
  });

  it('is done once every stop is behind the driver', () => {
    const done = { pickupConfirmedAt: AT, droppedOffAt: LATER };
    const state = leg(riders({ a: done, b: done, c: done }), {
      arrived: ['p1', 'p2', 'd1', 'd2'],
      departed: ['p1', 'p2', 'd1', 'd2'],
    });
    expect(state).toMatchObject({ phase: 'done', current: null, next: null, canStartNextLeg: false });
  });

  it('is done straight away for a route with no stops', () => {
    expect(deriveLegState([], new Set(), new Set())).toMatchObject({ phase: 'done', current: null, stops: [] });
  });
});
