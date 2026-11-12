import { describe, expect, it } from '@jest/globals';

import type { BookingStop } from '../../types/api.types';
import { BookingTripType } from '../../types/enums';
import {
  distanceTimeLabel,
  kmLabel,
  minutesLabel,
  passengersLabel,
  placeText,
  routeStopItems,
  routeSummaryLine,
  stopTimeLabel,
  tripTypeLabel,
} from './bookingRoute';

function stop(over: Partial<BookingStop>): BookingStop {
  return {
    id: 's',
    type: 'PICKUP',
    sortOrder: 0,
    label: 'Qasimabad',
    lat: 25.39,
    lng: 68.35,
    city: 'hyderabad',
    note: null,
    legDistanceKm: null,
    legDurationMinutes: null,
    expectedAt: null,
    ...over,
  };
}

describe('labels (same wording as KerayeGo Partner)', () => {
  it('words kilometres and minutes', () => {
    expect(kmLabel(330.4)).toBe('330 km');
    expect(kmLabel(4.46)).toBe('4.5 km');
    expect(minutesLabel(430)).toBe('7 h 10 min');
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(180)).toBe('3 h');
    expect(distanceTimeLabel(330, 320)).toBe('330 km · 5 h 20 min');
    expect(distanceTimeLabel(null, 50)).toBe('50 min');
    expect(distanceTimeLabel(null, null)).toBeNull();
  });

  it('words passengers and the trip type, and stays quiet on older requests', () => {
    expect(passengersLabel(1)).toBe('1 passenger');
    expect(passengersLabel(3)).toBe('3 passengers');
    expect(passengersLabel(null)).toBeNull();
    expect(tripTypeLabel(BookingTripType.ROUND_TRIP)).toBe('Round trip');
    expect(tripTypeLabel(BookingTripType.ONE_WAY)).toBe('One way');
    expect(tripTypeLabel(null)).toBeNull();
  });

  it('adds the city to a place unless it already names it', () => {
    expect(placeText('Qasimabad', 'hyderabad')).toBe('Qasimabad, Hyderabad');
    expect(placeText('Qasimabad, Hyderabad', 'hyderabad')).toBe('Qasimabad, Hyderabad');
    expect(placeText('Qasimabad', null)).toBe('Qasimabad');
    expect(placeText('', 'larkana')).toBe('Larkana');
  });
});

describe('routeStopItems', () => {
  it('lists pickups then drop-offs in route order, numbering a kind only when there are several', () => {
    const items = routeStopItems([
      stop({ id: 'd1', type: 'DROPOFF', sortOrder: 2, label: 'Bypass Road', city: 'larkana', legDistanceKm: 300, legDurationMinutes: 290 }),
      stop({ id: 'p1', sortOrder: 0 }),
      stop({ id: 'p2', sortOrder: 1, label: 'Hala Naka', legDistanceKm: 4.5, legDurationMinutes: 12, note: ' gate 2 ' }),
    ]);
    expect(items.map((i) => [i.title, i.place, i.leg, i.note])).toEqual([
      ['Pickup 1', 'Qasimabad, Hyderabad', null, null],
      ['Pickup 2', 'Hala Naka, Hyderabad', '4.5 km · 12 min', 'gate 2'],
      ['Drop-off', 'Bypass Road, Larkana', '300 km · 4 h 50 min', null],
    ]);
  });

  it('is empty for an older request', () => {
    expect(routeStopItems(undefined)).toEqual([]);
  });
});

describe('stopTimeLabel', () => {
  it('shows the time alone on the pickup’s day, and the date too on a later one', () => {
    const start = new Date(2026, 10, 12, 9, 0).toISOString();
    const sameDay = new Date(2026, 10, 12, 10, 40).toISOString();
    const nextDay = new Date(2026, 10, 13, 1, 5).toISOString();
    expect(stopTimeLabel(sameDay, start)).toBe(new Date(sameDay).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    expect(stopTimeLabel(nextDay, start)).toContain(', ');
  });
});

describe('routeSummaryLine', () => {
  it('says first pickup → last drop-off with the route’s km', () => {
    expect(
      routeSummaryLine({
        stops: [
          stop({ sortOrder: 0 }),
          stop({ type: 'DROPOFF', sortOrder: 1, label: 'Bypass', city: 'larkana' }),
        ],
        routeDistanceKm: 330.2,
        pickupLocation: 'Qasimabad',
      }),
    ).toBe('Hyderabad → Larkana · 330 km');
  });

  it('falls back to the place without a city, and to an older request’s free-text pickup', () => {
    expect(
      routeSummaryLine({
        stops: [stop({ city: null }), stop({ type: 'DROPOFF', sortOrder: 1, label: 'Airport', city: null })],
        routeDistanceKm: null,
        pickupLocation: null,
      }),
    ).toBe('Qasimabad → Airport');
    expect(routeSummaryLine({ stops: [], routeDistanceKm: null, pickupLocation: 'Dubai Marina' })).toBe('Dubai Marina');
    expect(routeSummaryLine({ pickupLocation: null })).toBeNull();
  });
});
