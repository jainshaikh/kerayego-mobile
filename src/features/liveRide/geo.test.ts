import { describe, expect, it } from '@jest/globals';

import { formatDistanceShort, haversineDistanceMeters, type GeoPoint } from './geo';

// Same city fixtures as kerayego-backend/src/common/utils/geo.util.spec.ts —
// this helper is a meters-instead-of-km copy of the backend's
// haversineDistanceKm, so both suites should agree on these distances.
const KARACHI: GeoPoint = { lat: 24.8607, lng: 67.0011 };
const HYDERABAD: GeoPoint = { lat: 25.396, lng: 68.3578 };

describe('haversineDistanceMeters', () => {
  it('is 0 for the same point', () => {
    expect(haversineDistanceMeters(KARACHI, KARACHI)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineDistanceMeters(KARACHI, HYDERABAD)).toBeCloseTo(
      haversineDistanceMeters(HYDERABAD, KARACHI),
      6,
    );
  });

  it('is ~111,195 m per degree of latitude on a 6371 km sphere', () => {
    expect(haversineDistanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_194.93, 1);
  });

  it('matches the backend haversineDistanceKm value x 1000 for Karachi -> Hyderabad', () => {
    // Backend: haversineDistanceKm(KARACHI, HYDERABAD) = 148.98612853… km
    // (straight line, not road distance).
    expect(haversineDistanceMeters(KARACHI, HYDERABAD)).toBeCloseTo(148_986.13, 1);
  });

  it('resolves the ~100 m arrival radius the ride screens gate on', () => {
    // 0.0009° of latitude is just over 100 m.
    const north = { lat: KARACHI.lat + 0.0009, lng: KARACHI.lng };
    const meters = haversineDistanceMeters(KARACHI, north);
    expect(meters).toBeGreaterThan(100);
    expect(meters).toBeLessThan(100.2);
  });
});

describe('formatDistanceShort', () => {
  it('shows whole meters below 1 km', () => {
    expect(formatDistanceShort(0)).toBe('0 m');
    expect(formatDistanceShort(0.4)).toBe('400 m');
    expect(formatDistanceShort(0.0456)).toBe('46 m');
  });

  it('shows one decimal of km from 1 km up', () => {
    expect(formatDistanceShort(1)).toBe('1.0 km');
    expect(formatDistanceShort(12.34)).toBe('12.3 km');
  });

  it('rounds a value just under 1 km to "1000 m" rather than "1.0 km"', () => {
    // Pins current behaviour at the unit boundary: the km/m switch happens
    // before rounding, so 999.6 m still takes the meters branch.
    expect(formatDistanceShort(0.9996)).toBe('1000 m');
  });
});
