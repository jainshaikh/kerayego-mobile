import { describe, expect, it } from '@jest/globals';

import { summarizeRide } from './rideSummary';
import type { CockpitRider } from './stopProgress';

function rider(id: string, seats: number, noShow = false): CockpitRider {
  return {
    id,
    requestedSeats: seats,
    pickupNote: null,
    pickupConfirmedAt: noShow ? null : '2026-10-08T09:10:00.000Z',
    pickupSource: null,
    droppedOffAt: noShow ? null : '2026-10-08T09:40:00.000Z',
    noShowAt: noShow ? '2026-10-08T09:20:00.000Z' : null,
    pickupStop: null,
    dropoffStop: null,
    user: { id: `user-${id}`, name: id, phone: null },
    noShow,
  };
}

describe('summarizeRide', () => {
  it('counts every rider as completed except no-shows, and only the seats actually travelled', () => {
    const summary = summarizeRide([rider('a', 2), rider('b', 1, true), rider('c', 1)]);

    expect(summary).toMatchObject({ completedCount: 2, noShowCount: 1, seats: 3 });
    expect(summary.riders.map((r) => r.outcome)).toEqual(['completed', 'noShow', 'completed']);
  });

  it('is all zeros for a ride with no riders', () => {
    expect(summarizeRide([])).toEqual({ riders: [], completedCount: 0, noShowCount: 0, seats: 0 });
  });
});
