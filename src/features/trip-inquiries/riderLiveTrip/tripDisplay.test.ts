import { describe, expect, it } from '@jest/globals';

import type { TripInquiry, TripInquiryTrip } from '../../../api/trip-inquiries.api';
import { Market, TripInquiryStatus, TripStatus, VehicleStatus } from '../../../types/enums';
import {
  driverCallNumber,
  ownDropoffPoint,
  ownPickupPoint,
  riderTripVehicle,
  seatFare,
  tripCurrency,
  tripOperator,
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
    expect(tripCurrency(trip({ userVehicle: { ...trip().userVehicle!, country: Market.SA } }))).toBe('PKR');
    expect(tripCurrency(trip({ userVehicle: { ...trip().userVehicle!, country: Market.AE } }))).toBe('PKR');
  });

  it('falls back to the default market on a return trip (no userVehicle)', () => {
    expect(tripCurrency(trip({ userVehicle: null }))).toBe('PKR');
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

describe('riderTripVehicle', () => {
  const fleetVehicle = {
    id: 'v-1',
    title: '2023 Toyota Camry SE',
    make: 'toyota',
    model: 'camry',
    year: 2023,
    seatingCapacity: 4,
    status: VehicleStatus.APPROVED,
    images: [{ id: 'img-1', url: 'https://example.com/camry.jpg', altText: 'Camry', sortOrder: 0 }],
  };

  it("shows the driver's own car on a normal trip, with no operator", () => {
    expect(riderTripVehicle(trip())).toEqual({
      name: '2019 Toyota Corolla',
      shortName: 'Toyota Corolla',
      color: 'white',
      plateNumber: 'ABC-123',
      cover: null,
      operatedBy: null,
    });
  });

  it("shows the business's fleet car and who operates it on a return trip", () => {
    const returnTrip = trip({
      isReturnTrip: true,
      userVehicle: null,
      fleetVehicle,
      providerProfile: { id: 'pp-1', businessName: 'Lahore Rent A Car' },
    });
    expect(riderTripVehicle(returnTrip)).toEqual({
      name: '2023 Toyota Camry SE',
      shortName: '2023 Toyota Camry SE',
      color: null,
      plateNumber: null,
      cover: fleetVehicle.images[0],
      operatedBy: 'Lahore Rent A Car',
    });
  });

  it('is null when the backend sent no car (e.g. an older backend on a return trip)', () => {
    expect(riderTripVehicle(trip({ isReturnTrip: true, userVehicle: null }))).toBeNull();
  });
});

describe('tripOperator', () => {
  it('names the business only on a return trip', () => {
    const providerProfile = { id: 'pp-1', businessName: ' Lahore Rent A Car ' };
    expect(tripOperator({ isReturnTrip: true, providerProfile })).toBe('Lahore Rent A Car');
    expect(tripOperator({ isReturnTrip: false, providerProfile })).toBeNull();
    expect(tripOperator({ isReturnTrip: true, providerProfile: null })).toBeNull();
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
