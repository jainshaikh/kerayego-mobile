import { describe, expect, it } from '@jest/globals';

import { BookingRequestStatus } from '../../types/enums';
import {
  bookingStatusExplanation,
  createBookingError,
  DUPLICATE_ACTIVE_BOOKING_MESSAGE,
  upcomingRentalDriver,
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

describe('upcomingRentalDriver', () => {
  const driver = { id: 'drv-1', name: 'Ali Khan', avatarUrl: null, phone: '+923001112222' };

  it('shows the assigned driver of an ACCEPTED booking with their phone', () => {
    expect(upcomingRentalDriver({ status: BookingRequestStatus.ACCEPTED, assignedDriver: driver })).toEqual({
      name: 'Ali Khan',
      phone: '+923001112222',
    });
  });

  it('keeps the driver but no phone while the backend withholds it (job not accepted yet)', () => {
    expect(
      upcomingRentalDriver({ status: BookingRequestStatus.ACCEPTED, assignedDriver: { ...driver, phone: null } }),
    ).toEqual({ name: 'Ali Khan', phone: null });
  });

  it('shows nothing without an assigned driver (or from an older backend)', () => {
    expect(upcomingRentalDriver({ status: BookingRequestStatus.ACCEPTED, assignedDriver: null })).toBeNull();
    expect(upcomingRentalDriver({ status: BookingRequestStatus.ACCEPTED })).toBeNull();
  });

  it.each(Object.values(BookingRequestStatus).filter((s) => s !== BookingRequestStatus.ACCEPTED))(
    'shows nothing for a %s booking',
    (status) => {
      expect(upcomingRentalDriver({ status, assignedDriver: driver })).toBeNull();
    },
  );
});
