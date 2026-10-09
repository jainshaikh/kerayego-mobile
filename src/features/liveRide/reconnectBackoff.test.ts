import { describe, expect, it } from '@jest/globals';

import {
  computeReconnectDelayMs,
  SOCKET_RECONNECT_BASE_DELAY_MS,
  SOCKET_RECONNECT_MAX_DELAY_MS,
} from './reconnectBackoff';

const noJitterTop = () => 1;
const noJitterBottom = () => 0;

describe('computeReconnectDelayMs', () => {
  it('doubles from 1 s and caps at 30 s (upper edge of the jitter band)', () => {
    const schedule = Array.from({ length: 8 }, (_, attempt) => computeReconnectDelayMs(attempt, noJitterTop));
    expect(schedule).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('never goes below half the step (lower edge of the jitter band)', () => {
    const schedule = Array.from({ length: 7 }, (_, attempt) => computeReconnectDelayMs(attempt, noJitterBottom));
    expect(schedule).toEqual([500, 1000, 2000, 4000, 8000, 15_000, 15_000]);
  });

  it('spreads devices dropped together across [50 %, 100 %] of the step', () => {
    expect(computeReconnectDelayMs(2, () => 0.5)).toBe(3000);
    for (let i = 0; i < 50; i += 1) {
      const delay = computeReconnectDelayMs(3);
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(8000);
    }
  });

  it('stays finite and capped however long the loop runs', () => {
    expect(computeReconnectDelayMs(10_000, noJitterTop)).toBe(SOCKET_RECONNECT_MAX_DELAY_MS);
    expect(computeReconnectDelayMs(Number.POSITIVE_INFINITY, noJitterTop)).toBe(SOCKET_RECONNECT_MAX_DELAY_MS);
  });

  it('treats a negative/NaN attempt as the first one and a fractional one as its floor', () => {
    expect(computeReconnectDelayMs(-3, noJitterTop)).toBe(SOCKET_RECONNECT_BASE_DELAY_MS);
    expect(computeReconnectDelayMs(Number.NaN, noJitterTop)).toBe(SOCKET_RECONNECT_BASE_DELAY_MS);
    expect(computeReconnectDelayMs(1.9, noJitterTop)).toBe(2000);
  });

  it('clamps an out-of-range random source into the jitter band', () => {
    expect(computeReconnectDelayMs(0, () => 7)).toBe(1000);
    expect(computeReconnectDelayMs(0, () => -7)).toBe(500);
  });
});
