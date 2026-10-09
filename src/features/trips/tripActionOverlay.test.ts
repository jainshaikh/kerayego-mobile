import { describe, expect, it } from '@jest/globals';

import type { TripActionDraft } from '../../storage/offline-trip-queue';
import { TripEventType } from '../../types/enums';
import { deriveTripActionOverlay } from './tripActionOverlay';

const TRIP = 'trip-a';

function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 8, 9, minute)).toISOString();
}

function start(id = 's'): TripActionDraft {
  return { id, kind: 'start', tripId: TRIP, createdAt: at(0) };
}

function end(id = 'e'): TripActionDraft {
  return { id, kind: 'end', tripId: TRIP, createdAt: at(59) };
}

function riderEvent(id: string, type: TripEventType, tripInquiryId: string | undefined, minute: number): TripActionDraft {
  return { id, kind: 'event', tripId: TRIP, createdAt: at(minute), payload: { id, tripInquiryId, type, occurredAt: at(minute) } };
}

function driverArrived(id: string, stopId: string, minute: number): TripActionDraft {
  return {
    id,
    kind: 'event',
    tripId: TRIP,
    createdAt: at(minute),
    payload: { id, type: TripEventType.ARRIVED, occurredAt: at(minute), payload: { stopId, lat: 24.86, lng: 67.0 } },
  };
}

describe('deriveTripActionOverlay', () => {
  it('is empty for no actions', () => {
    expect(deriveTripActionOverlay([])).toEqual({
      started: false,
      ended: false,
      riderEvents: {},
      noShowIds: new Set(),
      arrivedStopIds: new Set(),
      arrivedInquiryIds: new Set(),
    });
  });

  it('marks the trip started and ended', () => {
    expect(deriveTripActionOverlay([start()])).toMatchObject({ started: true, ended: false });
    expect(deriveTripActionOverlay([start(), end()])).toMatchObject({ started: true, ended: true });
  });

  it("records each rider's pickup and drop-off at their tap times", () => {
    const overlay = deriveTripActionOverlay([
      riderEvent('p1', TripEventType.PICKUP, 'inq-1', 5),
      riderEvent('p2', TripEventType.PICKUP, 'inq-2', 6),
      riderEvent('d1', TripEventType.DROPOFF, 'inq-1', 30),
    ]);

    expect(overlay.riderEvents).toEqual({
      'inq-1': { pickupConfirmedAt: at(5), droppedOffAt: at(30) },
      'inq-2': { pickupConfirmedAt: at(6) },
    });
  });

  it('marks a no-show, and a later pickup for the same rider reverses it', () => {
    const noShow = riderEvent('n1', TripEventType.NO_SHOW, 'inq-1', 10);
    expect(deriveTripActionOverlay([noShow]).noShowIds).toEqual(new Set(['inq-1']));

    const reversed = deriveTripActionOverlay([noShow, riderEvent('p1', TripEventType.PICKUP, 'inq-1', 12)]);
    expect(reversed.noShowIds).toEqual(new Set());
    expect(reversed.riderEvents['inq-1']).toEqual({ pickupConfirmedAt: at(12) });
  });

  it("tells the driver's stop arrival apart from a rider's own arrival self-report", () => {
    const overlay = deriveTripActionOverlay([
      driverArrived('a1', 'stop-1', 4),
      riderEvent('r1', TripEventType.ARRIVED, 'inq-3', 5),
    ]);

    expect(overlay.arrivedStopIds).toEqual(new Set(['stop-1']));
    expect(overlay.arrivedInquiryIds).toEqual(new Set(['inq-3']));
  });

  it('counts an action that is both applied and still queued once, in its first position', () => {
    const noShow = riderEvent('n1', TripEventType.NO_SHOW, 'inq-1', 10);
    const pickup = riderEvent('p1', TripEventType.PICKUP, 'inq-1', 12);

    // Applied this session [no-show, pickup], while the screen's pending
    // snapshot is a read behind and still holds the no-show: its stale copy
    // must not re-apply the no-show the later pickup reversed.
    expect(deriveTripActionOverlay([noShow, pickup, noShow]).noShowIds).toEqual(new Set());
  });

  it('ignores rider events without a tripInquiryId', () => {
    const overlay = deriveTripActionOverlay([
      riderEvent('p1', TripEventType.PICKUP, undefined, 5),
      riderEvent('n1', TripEventType.NO_SHOW, undefined, 6),
    ]);
    expect(overlay.riderEvents).toEqual({});
    expect(overlay.noShowIds).toEqual(new Set());
  });
});
