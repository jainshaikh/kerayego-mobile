import type { BookingRequest, BookingStop } from '../../types/api.types';
import { BookingTripType } from '../../types/enums';
import { titleCase } from '../../utils/format';

// How a rental request's route reads (plan §3c, A78) — the same wording as
// KerayeGo Partner's features/booking-requests/bookingRoute.ts, so the
// customer and the business see the same numbers the same way. Pure.

/** "330 km"; under 10 km with one decimal ("4.5 km"). */
export function kmLabel(km: number): string {
  if (km < 10) return `${Math.round(km * 10) / 10} km`;
  return `${Math.round(km)} km`;
}

/**
 * "7 h 10 min", "45 min", "3 h". The backend's messages say "45 m"; the apps
 * say "min", since "50 m" next to "4.5 km" reads like metres.
 */
export function minutesLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "1 passenger", "3 passengers" — null when the request doesn't say (older requests). */
export function passengersLabel(count: number | null | undefined): string | null {
  if (!count) return null;
  return `${count} ${count === 1 ? 'passenger' : 'passengers'}`;
}

/** "330 km · 5 h 20 min" — whichever of the two is known; null with neither. */
export function distanceTimeLabel(km: number | null | undefined, minutes: number | null | undefined): string | null {
  const parts = [km != null ? kmLabel(km) : null, minutes != null ? minutesLabel(minutes) : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export const TRIP_TYPE_LABELS: Record<BookingTripType, string> = {
  [BookingTripType.ONE_WAY]: 'One way',
  [BookingTripType.ROUND_TRIP]: 'Round trip',
};

/** "One way" / "Round trip"; null for a week or month request or an older one. */
export function tripTypeLabel(tripType: BookingTripType | null | undefined): string | null {
  return tripType ? (TRIP_TYPE_LABELS[tripType] ?? null) : null;
}

/** A place with its city, unless the place already names it: "Qasimabad, Hyderabad". */
export function placeText(label: string | null | undefined, city: string | null | undefined): string | null {
  const address = label?.trim() ?? '';
  const town = city?.trim() ? titleCase(city.trim()) : '';
  if (!address) return town || null;
  if (!town || address.toLowerCase().includes(town.toLowerCase())) return address;
  return `${address}, ${town}`;
}

type StopLike = Pick<
  BookingStop,
  'type' | 'sortOrder' | 'label' | 'city' | 'note' | 'legDistanceKm' | 'legDurationMinutes' | 'expectedAt'
> & { id?: string };

export interface RouteStopItem {
  key: string;
  kind: 'pickup' | 'dropoff';
  /** "Pickup", "Drop-off" — numbered ("Pickup 2") when there's more than one of that kind. */
  title: string;
  place: string;
  note: string | null;
  /** ISO; null when it couldn't be worked out (week/month requests have none). */
  expectedAt: string | null;
  /** "45 km · 50 min" — the drive from the stop before; null on the first stop and when unknown. */
  leg: string | null;
}

/** The stops in route order (every pickup, then every drop-off), ready to list. Empty for older requests. */
export function routeStopItems(stops: readonly StopLike[] | undefined): RouteStopItem[] {
  const ordered = [...(stops ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const totals = {
    pickup: ordered.filter((stop) => stop.type === 'PICKUP').length,
    dropoff: ordered.filter((stop) => stop.type !== 'PICKUP').length,
  };
  const seen = { pickup: 0, dropoff: 0 };
  return ordered.map((stop, index) => {
    const kind = stop.type === 'PICKUP' ? 'pickup' : 'dropoff';
    seen[kind] += 1;
    const base = kind === 'pickup' ? 'Pickup' : 'Drop-off';
    return {
      key: stop.id ?? `${stop.type}-${stop.sortOrder}`,
      kind,
      title: totals[kind] > 1 ? `${base} ${seen[kind]}` : base,
      place: placeText(stop.label, stop.city) ?? stop.label,
      note: stop.note?.trim() || null,
      expectedAt: stop.expectedAt,
      leg: index === 0 ? null : distanceTimeLabel(stop.legDistanceKm, stop.legDurationMinutes),
    };
  });
}

/**
 * When the car should reach a stop: the time alone ("10:40 AM") on the
 * pickup's day, with the date ("12 Nov, 10:40 AM") on a later one. In the
 * phone's locale and time zone.
 */
export function stopTimeLabel(expectedAt: string, startIso: string): string {
  const at = new Date(expectedAt);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === new Date(startIso).toDateString()) return time;
  return `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/** A rental's start or end: "12 Nov 2026, 9:30 AM", in the phone's zone. */
export function bookingTimeLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A stop's short name for a one-line route: its city, else its place.
function shortPlace(stop: { label: string; city: string | null }): string {
  return stop.city?.trim() ? titleCase(stop.city.trim()) : stop.label.trim();
}

/**
 * The request in one line for a list: "Hyderabad → Larkana · 330 km" — first
 * pickup → last drop-off, with the route's km when it was worked out. Older
 * requests: their free-text pickup, or null.
 */
export function routeSummaryLine(
  booking: Pick<BookingRequest, 'stops' | 'routeDistanceKm' | 'pickupLocation'>,
): string | null {
  const stops = [...(booking.stops ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const first = stops.find((stop) => stop.type === 'PICKUP');
  const last = [...stops].reverse().find((stop) => stop.type === 'DROPOFF');
  if (!first || !last) return booking.pickupLocation?.trim() || null;
  const line = `${shortPlace(first)} → ${shortPlace(last)}`;
  return booking.routeDistanceKm != null ? `${line} · ${kmLabel(booking.routeDistanceKm)}` : line;
}
