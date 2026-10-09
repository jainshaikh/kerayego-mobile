import type { TripInquiry, TripInquiryTrip, TripInquiryVehicle } from '../../../api/trip-inquiries.api';
import { currencyForMarket } from '../../../constants/markets';
import { formatPrice, titleCase } from '../../../utils/format';

/** The trip's currency — it follows the market of the vehicle it was posted with. */
export function tripCurrency(trip: Pick<TripInquiryTrip, 'userVehicle'>): string {
  return currencyForMarket(trip.userVehicle?.country);
}

// Backend Decimal fields (pricePerSeat) serialize as strings over JSON.
function parsePrice(value: string | number): number | null {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(num) ? num : null;
}

export interface SeatFare {
  // e.g. "PKR 1,500"
  perSeat: string;
  // e.g. "PKR 3,000"
  total: string;
  // e.g. "2 seats × PKR 1,500"
  breakdown: string;
}

/**
 * What this request costs — seats × the flat per-seat price, every rider
 * travelling the whole route. Paid to the driver directly, so this is display
 * only. null when the price can't be read.
 */
export function seatFare(pricePerSeat: string | number, seats: number, currency: string): SeatFare | null {
  const price = parsePrice(pricePerSeat);
  if (price === null || !Number.isFinite(seats) || seats < 0) return null;
  const perSeat = formatPrice(price, currency);
  return {
    perSeat,
    total: formatPrice(price * seats, currency),
    breakdown: `${seats} seat${seats !== 1 ? 's' : ''} × ${perSeat}`,
  };
}

/** e.g. "2019 Toyota Corolla", or "Toyota Corolla" without a year. */
export function vehicleDisplayName(vehicle: Pick<TripInquiryVehicle, 'make' | 'model' | 'year'>, withYear = true): string {
  const name = `${titleCase(vehicle.make)} ${titleCase(vehicle.model)}`;
  return withYear && vehicle.year ? `${vehicle.year} ${name}` : name;
}

/**
 * The number "Call" dials: the driver's own phone, which the backend sends
 * the rider only once their seat is ACCEPTED, else the listing's public
 * contact number — the same rule web uses (postedBy.phone ?? contactNumber).
 */
export function driverCallNumber(trip: Pick<TripInquiryTrip, 'postedBy' | 'contactNumber'>): string | null {
  return trip.postedBy.phone || trip.contactNumber || null;
}

/** A wa.me link — it takes digits only (no '+', spaces or dashes). null when there are none. */
export function whatsappUrl(number: string | null | undefined): string | null {
  const digits = (number ?? '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : null;
}

export interface OwnStopPoint {
  label: string;
  lat: number | null;
  lng: number | null;
}

/**
 * Where THIS rider gets picked up: the stop they chose. A legacy request made
 * before stops existed has none — the trip's single pickup point (which
 * pickupPoint still mirrors) was the only choice then.
 */
export function ownPickupPoint(inquiry: Pick<TripInquiry, 'pickupStop' | 'trip'>): OwnStopPoint {
  if (inquiry.pickupStop) {
    const { label, lat, lng } = inquiry.pickupStop;
    return { label, lat, lng };
  }
  const { trip } = inquiry;
  return { label: trip.pickupPoint, lat: trip.pickupLat ?? null, lng: trip.pickupLng ?? null };
}

/** Where THIS rider gets dropped off — same legacy fallback, then the destination city. */
export function ownDropoffPoint(inquiry: Pick<TripInquiry, 'dropoffStop' | 'trip'>): OwnStopPoint {
  if (inquiry.dropoffStop) {
    const { label, lat, lng } = inquiry.dropoffStop;
    return { label, lat, lng };
  }
  const { trip } = inquiry;
  if (trip.dropoffPoint) {
    return { label: trip.dropoffPoint, lat: trip.dropoffLat ?? null, lng: trip.dropoffLng ?? null };
  }
  return { label: titleCase(trip.destinationCity), lat: null, lng: null };
}
