import { describe, expect, it } from '@jest/globals';

import { haversineDistanceMeters } from '../../liveRide/geo';
import { remainingMinutes, routeProgress } from './routeProgress';

// A straight east-west road through Karachi, three vertices ~1 km apart.
const ROUTE = [
  { lat: 24.86, lng: 67.0 },
  { lat: 24.86, lng: 67.00989 },
  { lat: 24.86, lng: 67.01978 },
];
const ROUTE_M = haversineDistanceMeters(ROUTE[0], ROUTE[2]);

describe('routeProgress', () => {
  it('is null for a line too short to have a segment', () => {
    expect(routeProgress([], ROUTE[0])).toBeNull();
    expect(routeProgress([ROUTE[0]], ROUTE[0])).toBeNull();
  });

  it('starts with the whole route ahead when the driver is at its start', () => {
    const progress = routeProgress(ROUTE, ROUTE[0])!;
    expect(progress.offRouteM).toBeCloseTo(0, 3);
    expect(progress.remainingM).toBeCloseTo(ROUTE_M, 0);
  });

  it('trims the part already driven, measuring what is left from the nearest point', () => {
    // Halfway along the second segment.
    const position = { lat: 24.86, lng: 67.014835 };
    const progress = routeProgress(ROUTE, position)!;

    expect(progress.remainingM).toBeCloseTo(haversineDistanceMeters(position, ROUTE[2]), 0);
    expect(progress.remainingPolyline[0]).toEqual(position);
    expect(progress.remainingPolyline.slice(2)).toEqual([ROUTE[2]]);
  });

  it('reports how far off the line the driver is', () => {
    // ~111 m north of the first vertex.
    const progress = routeProgress(ROUTE, { lat: 24.861, lng: 67.0 })!;
    expect(progress.offRouteM).toBeGreaterThan(105);
    expect(progress.offRouteM).toBeLessThan(115);
  });

  it('snaps to the end of the route once past it', () => {
    const progress = routeProgress(ROUTE, { lat: 24.86, lng: 67.03 })!;
    expect(progress.remainingM).toBeCloseTo(0, 3);
    expect(progress.remainingPolyline.at(-1)).toEqual(ROUTE[2]);
  });
});

describe('remainingMinutes', () => {
  it("scales the route's drive time by the share of its distance left", () => {
    expect(remainingMinutes(1000, { distanceKm: 2, durationMinutes: 10 })).toBe(5);
  });

  it('never exceeds the full drive time, and is 0 for a zero-length route', () => {
    expect(remainingMinutes(5000, { distanceKm: 2, durationMinutes: 10 })).toBe(10);
    expect(remainingMinutes(100, { distanceKm: 0, durationMinutes: 3 })).toBe(0);
  });
});
