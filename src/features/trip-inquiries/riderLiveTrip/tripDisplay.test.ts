import { describe, expect, it } from '@jest/globals';

import type { TripInquiry, TripInquiryTrip } from '../../../api/trip-inquiries.api';
import { Market, TripInquiryStatus, TripStatus } from '../../../types/enums';
import {
  driverCallNumber,
  ownDropoffPoint,
  ownPickupPoint,
  seatFare,
  tripCurrency,
  vehicleDisplayName,
  whatsappUrl,
} from './tripDisplay';

function trip(overrides: Partial<TripInquiryTrip> = {}): TripInquiryTrip {
  return {
    id: 'trip-1',
    status: TripStatus.ACTIVE,
    originCity: 'karachi',
    destinationCity: 'hyderabad',
    pickupPoint: 'Liaquatabad Chowrangi',
    pickupLat: 24.91,
    pickupLng: 67.04,
    dropoffPoint: 'Hyderabad Bypass',
    dropoffLat: 25.39,
    dropoffLng: 68.37,
    departureAt: '2026-10-09T04:00:00.000Z',
    availableSeats: 3,
    pricePerSeat: '450.00',
    contactNumber: '+92 300 1234567',
    postedByUserId: 'driver-1',
    postedBy: { id: 'driver-1', name: 'Ali', email: 'ali@example.com', phone: '+923001112222' },
    userVehicle: {
      make: 'toyota',
      model: 'corolla',
      year: 2019,
      color: 'white',
      plateNumber: 'ABC-123',
      country: Market.PK,
      images: [],
    },
    ...overrides,
  };
}

function inquiry(overrides: Partial<TripInquiry> = {}): TripInquiry {
  return {
    id: 'inq-1',
    requestedSeats: 2,
    pickupNote: null,
    message: null,
    status: TripInquiryStatus.ACCEPTED,
    rejectionReason: null,
    pickupConfirmedAt: null,
    pickupSource: null,
    droppedOffAt: null,
    pickupStop: { id: 'p2', label: 'Gulshan Chowrangi', lat: 24.92, lng: 67.09 },
    dropoffStop: { id: 'd1', label: 'Qasimabad', lat: null, lng: null },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    user: { id: 'rider-1', name: 'Sara', email: 'sara@example.com', phone: null },
    trip: trip(),
    ...overrides,
  };
}

describe('tripCurrency', () => {
  it("follows the vehicle's market (web's markets.ts)", () => {
    expect(tripCurrency(trip())).toBe('PKR');
    expect(tripCurrency(trip({ userVehicle: { ...trip().userVehicle, country: Market.SA } }))).toBe('SAR');
    expect(tripCurrency(trip({ userVehicle: { ...trip().userVehicle, country: Market.AE } }))).toBe('AED');
  });
});

describe('seatFare', () => {
  it('multiplies seats by the per-seat price in the given currency', () => {
    expect(seatFare('450.00', 2, 'PKR')).toEqual({
      perSeat: 'PKR 450',
      total: 'PKR 900',
      breakdown: '2 seats × PKR 450',
    });
  });

  it('accepts a numeric price and a single seat', () => {
    expect(seatFare(300, 1, 'SAR')).toEqual({ perSeat: 'SAR 300', total: 'SAR 300', breakdown: '1 seat × SAR 300' });
  });

  it('groups thousands', () => {
    expect(seatFare('1500', 2, 'PKR')?.total).toMatch(/^PKR 3\D?000$/);
  });

  it('is null for an unreadable price', () => {
    expect(seatFare('abc', 2, 'PKR')).toBeNull();
  });
});

describe('vehicleDisplayName', () => {
  it('reads year, make and model', () => {
    expect(vehicleDisplayName({ make: 'toyota', model: 'corolla', year: 2019 })).toBe('2019 Toyota Corolla');
  });

  it('drops a missing year, or on request', () => {
    expect(vehicleDisplayName({ make: 'suzuki', model: 'alto', year: null })).toBe('Suzuki Alto');
    expect(vehicleDisplayName({ make: 'toyota', model: 'corolla', year: 2019 }, false)).toBe('Toyota Corolla');
  });
});

describe('driverCallNumber', () => {
  it("prefers the driver's own phone (sent once the seat is accepted)", () => {
    expect(driverCallNumber(trip())).toBe('+923001112222');
  });

  it("falls back to the listing's contact number while the phone is masked", () => {
    expect(driverCallNumber(trip({ postedBy: { id: 'driver-1', name: 'Ali', email: null, phone: null } }))).toBe(
      '+92 300 1234567',
    );
  });
});

describe('whatsappUrl', () => {
  it('keeps digits only', () => {
    expect(whatsappUrl('+92 300-123 4567')).toBe('https://wa.me/923001234567');
  });

  it('is null without any digits', () => {
    expect(whatsappUrl('')).toBeNull();
    expect(whatsappUrl(null)).toBeNull();
  });
});

describe("the rider's own stops", () => {
  it("uses the rider's chosen stops, not the trip's first/last points", () => {
    expect(ownPickupPoint(inquiry())).toEqual({ label: 'Gulshan Chowrangi', lat: 24.92, lng: 67.09 });
    expect(ownDropoffPoint(inquiry())).toEqual({ label: 'Qasimabad', lat: null, lng: null });
  });

  it("falls back to the trip's single pickup/drop-off point for a legacy request with no stops", () => {
    const legacy = inquiry({ pickupStop: null, dropoffStop: null });
    expect(ownPickupPoint(legacy)).toEqual({ label: 'Liaquatabad Chowrangi', lat: 24.91, lng: 67.04 });
    expect(ownDropoffPoint(legacy)).toEqual({ label: 'Hyderabad Bypass', lat: 25.39, lng: 68.37 });
  });

  it('falls back to the destination city when the trip has no drop-off point either', () => {
    const legacy = inquiry({ dropoffStop: null, trip: trip({ dropoffPoint: null, dropoffLat: null, dropoffLng: null }) });
    expect(ownDropoffPoint(legacy)).toEqual({ label: 'Hyderabad', lat: null, lng: null });
  });
});
