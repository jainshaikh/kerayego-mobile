import { describe, expect, it } from '@jest/globals';

import type { ManifestRider, ManifestRouteStop } from '../../../api/trips.api';
import { PickupSource } from '../../../types/enums';
import {
  isRiderDoneAtStop,
  mergeArrivedStopIds,
  mergeCockpitRiders,
  mergeDepartedStopIds,
  resolveStops,
  type CockpitRider,
} from './stopProgress';

const AT = '2026-10-08T09:10:00.000Z';
const LATER = '2026-10-08T09:40:00.000Z';

function stop(id: string, type: ManifestRouteStop['type'], arrivedAt?: string | null): ManifestRouteStop {
  return { id, type, label: id, lat: 24.86, lng: 67.0, ...(arrivedAt !== undefined ? { arrivedAt } : {}) };
}

// Visit order as the backend sends it: pickups, then drop-offs.
const P1 = stop('p1', 'PICKUP');
const P2 = stop('p2', 'PICKUP');
const D1 = stop('d1', 'DROPOFF');
const D2 = stop('d2', 'DROPOFF');
const ROUTE = [P1, P2, D1, D2];

function ref(s: ManifestRouteStop) {
  return { id: s.id, label: s.label, lat: s.lat, lng: s.lng };
}

function manifestRider(id: string, pickup: ManifestRouteStop | null, dropoff: ManifestRouteStop | null, overrides: Partial<ManifestRider> = {}): ManifestRider {
  return {
    id,
    requestedSeats: 1,
    pickupNote: null,
    pickupConfirmedAt: null,
    pickupSource: null,
    droppedOffAt: null,
    noShowAt: null,
    pickupStop: pickup ? ref(pickup) : null,
    dropoffStop: dropoff ? ref(dropoff) : null,
    user: { id: `user-${id}`, name: id, phone: null },
    ...overrides,
  };
}

function cockpit(rider: ManifestRider, noShow = false): CockpitRider {
  return { ...rider, noShow };
}

const NO_OVERLAY = { riderEvents: {}, noShowIds: new Set<string>() };

// a: p1 → d1, b: p1 → d2, c: p2 → d2.
function riders(overrides: Partial<Record<'a' | 'b' | 'c', Partial<ManifestRider>>> = {}): ManifestRider[] {
  return [
    manifestRider('a', P1, D1, overrides.a),
    manifestRider('b', P1, D2, overrides.b),
    manifestRider('c', P2, D2, overrides.c),
  ];
}


describe('mergeCockpitRiders', () => {
  it("lets the server's values win and fills only the gaps from the overlay", () => {
    const [merged] = mergeCockpitRiders([manifestRider('a', P1, D1, { pickupConfirmedAt: AT, pickupSource: PickupSource.DRIVER_TAP })], {
      riderEvents: { a: { pickupConfirmedAt: LATER, droppedOffAt: LATER } },
      noShowIds: new Set(),
    });
    expect(merged).toMatchObject({ pickupConfirmedAt: AT, droppedOffAt: LATER, noShow: false });
  });

  it('marks an optimistic pickup as a driver tap', () => {
    const [merged] = mergeCockpitRiders([manifestRider('a', P1, D1)], {
      riderEvents: { a: { pickupConfirmedAt: AT } },
      noShowIds: new Set(),
    });
    expect(merged).toMatchObject({ pickupConfirmedAt: AT, pickupSource: PickupSource.DRIVER_TAP });
  });

  it("reads a no-show from the server's noShowAt", () => {
    const [merged] = mergeCockpitRiders([manifestRider('a', P1, D1, { noShowAt: AT })], NO_OVERLAY);
    expect(merged.noShow).toBe(true);
  });

  it('reads a no-show from a queued or just-sent NO_SHOW — also on an older backend with no noShowAt', () => {
    const legacy = manifestRider('a', P1, D1);
    delete legacy.noShowAt;
    const [merged] = mergeCockpitRiders([legacy], { riderEvents: {}, noShowIds: new Set(['a']) });
    expect(merged.noShow).toBe(true);
  });

  it('lets a pickup on either side outrank a no-show on either side — the reversal', () => {
    // Server no-show, then a queued PICKUP from the driver.
    const queuedPickup = mergeCockpitRiders([manifestRider('a', P1, D1, { noShowAt: AT })], {
      riderEvents: { a: { pickupConfirmedAt: LATER } },
      noShowIds: new Set(),
    });
    expect(queuedPickup[0]).toMatchObject({ noShow: false, pickupConfirmedAt: LATER });

    // A stale overlay no-show for a rider the server has as picked up.
    const serverPickup = mergeCockpitRiders([manifestRider('a', P1, D1, { pickupConfirmedAt: AT })], {
      riderEvents: {},
      noShowIds: new Set(['a']),
    });
    expect(serverPickup[0].noShow).toBe(false);
  });

  it('never shows a dropped-off rider as a no-show', () => {
    const [merged] = mergeCockpitRiders([manifestRider('a', P1, D1, { droppedOffAt: AT })], {
      riderEvents: {},
      noShowIds: new Set(['a']),
    });
    expect(merged.noShow).toBe(false);
  });
});

describe('isRiderDoneAtStop', () => {
  const base = manifestRider('a', P1, D1);

  it('is done at a pickup stop once picked up, and at a drop-off stop once dropped off', () => {
    expect(isRiderDoneAtStop(cockpit(base), 'PICKUP')).toBe(false);
    expect(isRiderDoneAtStop(cockpit({ ...base, pickupConfirmedAt: AT }), 'PICKUP')).toBe(true);
    expect(isRiderDoneAtStop(cockpit({ ...base, pickupConfirmedAt: AT }), 'DROPOFF')).toBe(false);
    expect(isRiderDoneAtStop(cockpit({ ...base, pickupConfirmedAt: AT, droppedOffAt: LATER }), 'DROPOFF')).toBe(true);
  });

  it('treats a no-show as done at both their pickup and their drop-off stop', () => {
    expect(isRiderDoneAtStop(cockpit(base, true), 'PICKUP')).toBe(true);
    expect(isRiderDoneAtStop(cockpit(base, true), 'DROPOFF')).toBe(true);
  });

  it("treats a rider who's already dropped off (self-reported, no pickup tap) as done at their pickup stop", () => {
    expect(isRiderDoneAtStop(cockpit({ ...base, droppedOffAt: AT }), 'PICKUP')).toBe(true);
  });
});

describe('resolveStops', () => {
  it("groups each stop's riders in visit order", () => {
    const resolutions = resolveStops(ROUTE, mergeCockpitRiders(riders(), NO_OVERLAY));
    expect(resolutions.map((r) => r.stop.id)).toEqual(['p1', 'p2', 'd1', 'd2']);
    expect(resolutions.map((r) => r.riders.map((x) => x.id))).toEqual([['a', 'b'], ['c'], ['a'], ['b', 'c']]);
  });

  it('resolves a stop once everyone there needs nothing more — no-shows included', () => {
    const resolutions = resolveStops(
      ROUTE,
      mergeCockpitRiders(riders({ a: { noShowAt: AT }, b: { pickupConfirmedAt: AT } }), NO_OVERLAY),
    );
    expect(resolutions.map((r) => r.resolved)).toEqual([true, false, true, false]);
  });

  it('keeps a rider with no stops (legacy data) in the list without grouping them anywhere', () => {
    const merged = mergeCockpitRiders([...riders(), manifestRider('legacy', null, null)], NO_OVERLAY);
    expect(merged.map((r) => r.id)).toContain('legacy');
    expect(resolveStops(ROUTE, merged).some((r) => r.riders.some((x) => x.id === 'legacy'))).toBe(false);
  });
});

describe('mergeArrivedStopIds', () => {
  it("combines the server's arrivals with the ones tapped on this device", () => {
    const route = [stop('p1', 'PICKUP', AT), stop('p2', 'PICKUP', null), stop('d1', 'DROPOFF', null)];
    expect(mergeArrivedStopIds(route, new Set(['p2']))).toEqual(new Set(['p1', 'p2']));
  });

  it('falls back to the overlay alone on an older backend (no arrivedAt)', () => {
    expect(mergeArrivedStopIds([P1, P2], new Set(['p1']))).toEqual(new Set(['p1']));
  });
});

describe('mergeDepartedStopIds', () => {
  it("combines the server's departures with the ones tapped on this device", () => {
    const route = [{ ...stop('p1', 'PICKUP', AT), departedAt: LATER }, stop('p2', 'PICKUP', AT), stop('d1', 'DROPOFF')];
    expect(mergeDepartedStopIds(route, new Set(['p2']))).toEqual(new Set(['p1', 'p2']));
  });
});
