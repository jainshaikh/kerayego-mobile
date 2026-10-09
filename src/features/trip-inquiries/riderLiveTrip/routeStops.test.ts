import { describe, expect, it } from '@jest/globals';

import { hasCoordinates, orderRouteStops, routeSequence, type RouteStop } from './routeStops';

function stop(id: string, type: RouteStop['type'], sortOrder: number, lat: number | null = 24.8, lng: number | null = 67): RouteStop {
  return { id, type, label: id, lat, lng, sortOrder };
}

describe('orderRouteStops', () => {
  it('puts every pickup before every drop-off, each by sortOrder — not by sortOrder alone', () => {
    // sortOrder restarts at 0 for each type, so a plain sortOrder sort
    // would interleave P0, D0, P1, D1.
    const shuffled = [stop('d1', 'DROPOFF', 1), stop('p1', 'PICKUP', 1), stop('d0', 'DROPOFF', 0), stop('p0', 'PICKUP', 0)];
    expect(orderRouteStops(shuffled).map((s) => s.id)).toEqual(['p0', 'p1', 'd0', 'd1']);
  });

  it('leaves its input untouched', () => {
    const input = [stop('d0', 'DROPOFF', 0), stop('p0', 'PICKUP', 0)];
    orderRouteStops(input);
    expect(input.map((s) => s.id)).toEqual(['d0', 'p0']);
  });
});

describe('routeSequence', () => {
  const ordered = [stop('p0', 'PICKUP', 0), stop('p1', 'PICKUP', 1), stop('d0', 'DROPOFF', 0)];

  it("is the stop's 1-based position in route order", () => {
    expect(routeSequence(ordered, 'p1')).toBe(2);
    expect(routeSequence(ordered, 'd0')).toBe(3);
  });

  it('is null for a stop not on the route, or no stop', () => {
    expect(routeSequence(ordered, 'elsewhere')).toBeNull();
    expect(routeSequence(ordered, null)).toBeNull();
    expect(routeSequence([], 'p0')).toBeNull();
  });
});

describe('hasCoordinates', () => {
  it('accepts a stop with both coordinates, including 0', () => {
    expect(hasCoordinates(stop('a', 'PICKUP', 0, 0, 0))).toBe(true);
  });

  it('rejects a free-text stop (null coordinates) and no stop at all', () => {
    expect(hasCoordinates(stop('a', 'PICKUP', 0, null, null))).toBe(false);
    expect(hasCoordinates(stop('a', 'PICKUP', 0, 24.8, null))).toBe(false);
    expect(hasCoordinates(null)).toBe(false);
    expect(hasCoordinates(undefined)).toBe(false);
  });
});
