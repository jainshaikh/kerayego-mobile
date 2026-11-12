import { describe, expect, it } from '@jest/globals';

import { BookingRequestStatus } from '../../types/enums';
import {
  bookingStatusExplanation,
  createBookingError,
  DUPLICATE_ACTIVE_BOOKING_MESSAGE,
  rentalDriverCard,
} from './bookingDisplay';

describe('createBookingError', () => {
  it("shows the server's 409 message for a second active request on the same car", () => {
    expect(
      createBookingError({ kind: 'conflict', statusCode: 409, message: 'You already have an active inquiry for this vehicle' }),
    ).toEqual({ message: 'You already have an active inquiry for this vehicle', duplicate: true });
  });

  it('falls back to the known duplicate message when the 409 has none', () => {
    expect(createBookingError({ kind: 'conflict', statusCode: 409, message: '' })).toEqual({
      message: DUPLICATE_ACTIVE_BOOKING_MESSAGE,
      duplicate: true,
    });
  });

  it('passes any other error through as-is', () => {
    expect(createBookingError({ kind: 'validation', statusCode: 400, message: 'Pick a date' })).toEqual({
      message: 'Pick a date',
      duplicate: false,
    });
  });
});

describe('bookingStatusExplanation', () => {
  it('explains NOT_STARTED and nothing else', () => {
    for (const status of Object.values(BookingRequestStatus)) {
      const text = bookingStatusExplanation(status);
      if (status === BookingRequestStatus.NOT_STARTED) expect(text).toEqual(expect.any(String));
      else expect(text).toBeNull();
    }
  });
});

describe('rentalDriverCard (A86)', () => {
  const driver = {
    id: 'drv-1',
    name: 'Ali Khan',
    avatarUrl: 'https://img/ali.jpg',
    phone: '+923001112222',
    identityVerified: true,
    licenceVerified: false,
    rating: { average: 4.8, count: 23 },
    rideCount: 41,
  };

  it('shows the assigned driver of an ACCEPTED booking with the card and their phone', () => {
    expect(rentalDriverCard({ status: BookingRequestStatus.ACCEPTED, assignedDriver: driver })).toEqual({
      name: 'Ali Khan',
      avatarUrl: 'https://img/ali.jpg',
      identityVerified: true,
      licenceVerified: false,
      rating: { average: 4.8, count: 23 },
      rideCount: 41,
      contactPhone: '+923001112222',
      waitingForConfirmation: false,
    });
  });

  it('keeps the driver but no phone while the backend withholds it (job not accepted yet, D14)', () => {
    expect(
      rentalDriverCard({ status: BookingRequestStatus.ACCEPTED, assignedDriver: { ...driver, phone: null } }),
    ).toMatchObject({ contactPhone: null, waitingForConfirmation: true });
  });

  it('still shows the driver during and after the rental, without Call/WhatsApp (the live card has them)', () => {
    for (const status of [BookingRequestStatus.IN_PROGRESS, BookingRequestStatus.COMPLETED]) {
      expect(rentalDriverCard({ status, assignedDriver: driver })).toMatchObject({
        name: 'Ali Khan',
        contactPhone: null,
        waitingForConfirmation: false,
      });
    }
  });

  it('reads an older backend’s plain driver as unverified, unrated, no rides', () => {
    expect(
      rentalDriverCard({
        status: BookingRequestStatus.ACCEPTED,
        assignedDriver: { id: 'drv-1', name: 'Ali Khan', avatarUrl: null, phone: null },
      }),
    ).toMatchObject({ identityVerified: false, licenceVerified: false, rating: null, rideCount: 0 });
  });

  it('shows nothing without an assigned driver (or from an older backend)', () => {
    expect(rentalDriverCard({ status: BookingRequestStatus.ACCEPTED, assignedDriver: null })).toBeNull();
    expect(rentalDriverCard({ status: BookingRequestStatus.ACCEPTED })).toBeNull();
  });

  it.each([
    BookingRequestStatus.PENDING,
    BookingRequestStatus.CONTACTED,
    BookingRequestStatus.REJECTED,
    BookingRequestStatus.CANCELLED,
    BookingRequestStatus.NOT_STARTED,
  ])('shows nothing for a %s booking', (status) => {
    expect(rentalDriverCard({ status, assignedDriver: driver })).toBeNull();
  });
});
