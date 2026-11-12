import type { BookingStopPayload, CreateBookingRequestPayload, EstimateBookingPayload } from '../../api/booking-requests.api';
import type { NormalizedApiError } from '../../api/errors';
import { BookingErrorCode, type BookingEstimate, type RentalPackageChoice } from '../../types/api.types';
import { BookingTripType, RentalDurationType } from '../../types/enums';
import { COUNT_LIMITS, countError, isPriceToAgree, packageLabel } from '../../utils/rentalDuration';
import { createBookingError } from './bookingDisplay';
import { kmLabel, minutesLabel, placeText, stopTimeLabel } from './bookingRoute';

// The customer's rental request (plan §3c, A74–A85): the request sheet's
// values → POST /booking-requests (the new shape) and → the estimate
// (POST /booking-requests/estimate); the backend's answers → what the sheet
// shows. Pure — unit-tested in rentalRequest.test.ts.

/** At most this many pickups and drop-offs in all (the backend's MAX_BOOKING_STOPS). */
export const MAX_RENTAL_STOPS = 10;

/** A pickup or drop-off as the form holds it: coordinates only once a place was picked. */
export interface StopDraft {
  label: string;
  lat?: number;
  lng?: number;
}

/** What the request sheet holds. */
export interface RentalRequestDraft {
  requestedFromDate?: Date;
  durationType: RentalDurationType;
  durationQuantity: number;
  // Priced packages only; null until the customer picks one.
  tripType: BookingTripType | null;
  pickupStops: StopDraft[];
  dropoffStops: StopDraft[];
  passengerCount: number;
  // Week/month only (A85).
  driverHoursPerDay: number;
  daysPerWeek: number;
  kmPerMonth: number | null;
  message?: string;
}

/** A stop found by search or placed on the map — the backend needs its coordinates. */
export function isPlaced(stop: StopDraft): stop is StopDraft & { lat: number; lng: number } {
  return stop.label.trim().length > 0 && Number.isFinite(stop.lat) && Number.isFinite(stop.lng);
}

/** The stops as sent: every pickup in order, then every drop-off. Unplaced stops are left out. */
export function stopsPayload(pickups: readonly StopDraft[], dropoffs: readonly StopDraft[]): BookingStopPayload[] {
  const one = (type: 'PICKUP' | 'DROPOFF') => (stop: StopDraft) =>
    isPlaced(stop) ? [{ type, label: stop.label.trim(), lat: stop.lat, lng: stop.lng }] : [];
  return [...pickups.flatMap(one('PICKUP')), ...dropoffs.flatMap(one('DROPOFF'))];
}

/**
 * The stops whose city the backend uses (the first pickup → pickupCity, the
 * last drop-off → dropoffCity, which the return-trip rule A48 reads) — the
 * only ones worth looking a city up for.
 */
export function endStopIndexes(stops: readonly Pick<BookingStopPayload, 'type'>[]): number[] {
  const first = stops.findIndex((stop) => stop.type === 'PICKUP');
  let last = -1;
  stops.forEach((stop, index) => {
    if (stop.type === 'DROPOFF') last = index;
  });
  return [...new Set([first, last])].filter((index) => index >= 0);
}

/** The stops with the cities found for them (by index); a stop without one is sent without. */
export function withCities(
  stops: readonly BookingStopPayload[],
  cities: ReadonlyMap<number, string | null | undefined>,
): BookingStopPayload[] {
  return stops.map((stop, index) => {
    const city = cities.get(index)?.trim();
    return city ? { ...stop, city: city.slice(0, 100) } : stop;
  });
}

/** Whether every stop is placed, there's a pickup and a drop-off, and not more than 10 in all. */
export function stopsReady(draft: Pick<RentalRequestDraft, 'pickupStops' | 'dropoffStops'>): boolean {
  const all = [...draft.pickupStops, ...draft.dropoffStops];
  return (
    draft.pickupStops.length > 0 &&
    draft.dropoffStops.length > 0 &&
    all.length <= MAX_RENTAL_STOPS &&
    all.every(isPlaced)
  );
}

// The count as sent: none for an hour package (the backend takes absent or 1).
function countField(type: RentalDurationType, quantity: number): { durationQuantity?: number } {
  return COUNT_LIMITS[type] ? { durationQuantity: quantity } : {};
}

/**
 * What to ask the estimate for, or null while it can't be asked yet: a priced
 * package (week/month aren't routed, A79) with a valid count, a pickup time in
 * the future, a trip type, and every stop placed (A77 — "once every stop has a
 * place"). Ask again whenever this changes.
 */
export function estimateInputOf(
  draft: RentalRequestDraft,
  vehicleId: string,
  now: number = Date.now(),
): EstimateBookingPayload | null {
  const { requestedFromDate, durationType, durationQuantity, tripType } = draft;
  if (isPriceToAgree(durationType) || !tripType) return null;
  if (!requestedFromDate || !(requestedFromDate.getTime() > now)) return null;
  if (countError(durationType, durationQuantity)) return null;
  if (!stopsReady(draft)) return null;
  return {
    vehicleId,
    requestedFromDate: requestedFromDate.toISOString(),
    tripType,
    stops: stopsPayload(draft.pickupStops, draft.dropoffStops),
    durationType,
    ...countField(durationType, durationQuantity),
  };
}

/**
 * POST /booking-requests's body (the new shape). Priced packages carry the
 * trip type; week/month (price to agree) carry the driver's hours per day,
 * days per week and — when given — kilometres per month instead (A85).
 */
export function createPayloadOf(
  draft: RentalRequestDraft & { requestedFromDate: Date },
  vehicleId: string,
  stops: BookingStopPayload[],
): CreateBookingRequestPayload {
  const message = draft.message?.trim();
  const base = {
    vehicleId,
    requestedFromDate: draft.requestedFromDate.toISOString(),
    durationType: draft.durationType,
    ...countField(draft.durationType, draft.durationQuantity),
    stops,
    passengerCount: draft.passengerCount,
    ...(message ? { message } : {}),
  };
  if (isPriceToAgree(draft.durationType)) {
    return {
      ...base,
      driverHoursPerDay: draft.driverHoursPerDay,
      daysPerWeek: draft.daysPerWeek,
      ...(draft.kmPerMonth ? { kmPerMonth: draft.kmPerMonth } : {}),
    };
  }
  return { ...base, ...(draft.tripType ? { tripType: draft.tripType } : {}) };
}

const PRICED: readonly string[] = [RentalDurationType.HOURS_6, RentalDurationType.HOURS_12, RentalDurationType.DAY];

/** ROUTE_DOES_NOT_FIT's suggested package (error.details.suggestion), or null. */
export function suggestionOf(details: unknown): RentalPackageChoice | null {
  const suggestion = (details as { suggestion?: unknown } | null | undefined)?.suggestion as
    | { durationType?: unknown; durationQuantity?: unknown }
    | null
    | undefined;
  if (!suggestion || typeof suggestion.durationType !== 'string' || !PRICED.includes(suggestion.durationType)) return null;
  const quantity = typeof suggestion.durationQuantity === 'number' ? suggestion.durationQuantity : 1;
  return { durationType: suggestion.durationType as RentalDurationType, durationQuantity: quantity };
}

export const ROUTE_UNAVAILABLE_MESSAGE = "We couldn't check the route right now. Please try again in a moment.";

/** What the sheet shows when sending fails. */
export interface RequestFailure {
  message: string;
  // The "already have an active inquiry for this vehicle" 409 — offer the open one.
  duplicate: boolean;
  // ROUTE_DOES_NOT_FIT: the package to switch to (a "Choose 12 hours" button); null when none fits.
  suggestion: RentalPackageChoice | null;
  // A failure about one field — shown under it rather than above the button.
  field: 'requestedFromDate' | null;
}

export function rentalRequestFailure(error: NormalizedApiError): RequestFailure {
  const { message, duplicate } = createBookingError(error);
  const failure: RequestFailure = { message, duplicate, suggestion: null, field: null };
  if (error.code === BookingErrorCode.ROUTE_DOES_NOT_FIT) return { ...failure, suggestion: suggestionOf(error.details) };
  if (error.code === BookingErrorCode.START_TIME_PAST) return { ...failure, field: 'requestedFromDate' };
  if (error.code === BookingErrorCode.ROUTE_UNAVAILABLE) {
    return { ...failure, message: error.message || ROUTE_UNAVAILABLE_MESSAGE };
  }
  return failure;
}

/** The suggested package's button: "Choose 12 hours", "Choose 2 days". */
export function choosePackageLabel(choice: RentalPackageChoice): string {
  return `Choose ${packageLabel(choice.durationType, choice.durationQuantity)}`;
}

// ─── The estimate panel ─────────────────────────────────────────────────────

export type EstimateFit =
  | { fits: true; line: string; endsLine: string | null }
  | { fits: false; message: string; suggestion: RentalPackageChoice | null };

export interface EstimatePanel {
  // "330 km · 5 h 20 min driving" (round trip: "… driving, there and back").
  routeLine: string;
  // "About 7 h 10 min with stops and breaks" — only when that's more than the driving.
  neededLine: string | null;
  fit: EstimateFit | null;
  // Round trip: "About 3 h at Larkana" — what the package leaves at the destination.
  destinationLine: string | null;
}

// The last drop-off's short name, for "About 3 h at Larkana".
function destinationOf(estimate: BookingEstimate): string | null {
  const last = [...estimate.route.stops].reverse().find((stop) => stop.type === 'DROPOFF');
  if (!last) return null;
  return last.city?.trim() ? placeText(null, last.city) : last.label.trim();
}

/** What the estimate panel says for the package the customer picked. */
export function estimatePanelOf(estimate: BookingEstimate, tripType: BookingTripType): EstimatePanel {
  const { distanceKm, drivingMinutes, timeNeededMinutes } = estimate.route;
  const roundTrip = tripType === BookingTripType.ROUND_TRIP;
  const routeLine = `${kmLabel(distanceKm)} · ${minutesLabel(drivingMinutes)} driving${roundTrip ? ', there and back' : ''}`;
  const neededLine =
    timeNeededMinutes > drivingMinutes ? `About ${minutesLabel(timeNeededMinutes)} with stops and breaks` : null;

  const selected = estimate.selected;
  if (!selected) return { routeLine, neededLine, fit: null, destinationLine: null };

  const label = packageLabel(selected.durationType, selected.durationQuantity);
  let fit: EstimateFit;
  if (selected.fits) {
    const spare =
      selected.durationType !== RentalDurationType.DAY && selected.spareMinutes >= 1
        ? ` — about ${minutesLabel(selected.spareMinutes)} to spare`
        : '';
    fit = {
      fits: true,
      line: `Fits ${label}${spare}`,
      endsLine: selected.endsAt ? `Ends around ${stopTimeLabel(selected.endsAt, estimate.requestedFromDate)}` : null,
    };
  } else {
    const needs = `This trip needs about ${minutesLabel(timeNeededMinutes)} (${kmLabel(distanceKm)}).`;
    fit = {
      fits: false,
      message: estimate.suggestion
        ? `${needs} Choose ${packageLabel(estimate.suggestion.durationType, estimate.suggestion.durationQuantity)}.`
        : `${needs} It's too long for this car's packages.`,
      suggestion: estimate.suggestion,
    };
  }

  let destinationLine: string | null = null;
  const destination = destinationOf(estimate);
  if (roundTrip && selected.fits && selected.timeAtDestinationMinutes != null && destination) {
    destinationLine =
      selected.timeAtDestinationMinutes >= 1
        ? `About ${minutesLabel(selected.timeAtDestinationMinutes)} at ${destination}`
        : `No time to stay at ${destination} — the package only covers the drive`;
  }
  return { routeLine, neededLine, fit, destinationLine };
}
