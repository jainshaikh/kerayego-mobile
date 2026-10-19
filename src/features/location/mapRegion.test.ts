import { describe, expect, it } from '@jest/globals';

import { isSameSpot, zoomRegion } from './mapRegion';

const karachi = { latitude: 24.8607, longitude: 67.0011, latitudeDelta: 0.02, longitudeDelta: 0.01 };

describe('zoomRegion', () => {
  it('halves both spans to zoom in one level, keeping the centre', () => {
    expect(zoomRegion(karachi, 0.5)).toEqual({ ...karachi, latitudeDelta: 0.01, longitudeDelta: 0.005 });
  });

  it('doubles both spans to zoom out one level, keeping the centre', () => {
    expect(zoomRegion(karachi, 2)).toEqual({ ...karachi, latitudeDelta: 0.04, longitudeDelta: 0.02 });
  });

  it('stops zooming in at street level, keeping the aspect ratio', () => {
    const zoomed = zoomRegion({ ...karachi, latitudeDelta: 0.0006, longitudeDelta: 0.0003 }, 0.5);
    expect(zoomed.latitudeDelta).toBe(0.0005);
    expect(zoomed.longitudeDelta).toBeCloseTo(0.00025);
  });

  it('stops zooming out at a continent-wide span', () => {
    expect(zoomRegion({ ...karachi, latitudeDelta: 40, longitudeDelta: 20 }, 2)).toMatchObject({
      latitudeDelta: 60,
      longitudeDelta: 30,
    });
  });
});

describe('isSameSpot', () => {
  it('treats centres within a couple of metres as the same spot', () => {
    expect(isSameSpot(karachi, { latitude: karachi.latitude + 0.00001, longitude: karachi.longitude - 0.00001 })).toBe(true);
  });

  it('treats a centre moved along either axis as a new spot', () => {
    expect(isSameSpot(karachi, { latitude: karachi.latitude + 0.0001, longitude: karachi.longitude })).toBe(false);
    expect(isSameSpot(karachi, { latitude: karachi.latitude, longitude: karachi.longitude + 0.0001 })).toBe(false);
  });
});
