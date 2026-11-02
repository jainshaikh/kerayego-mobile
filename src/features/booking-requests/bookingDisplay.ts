import type { NormalizedApiError } from '../../api/errors';
import type { BookingRequest } from '../../types/api.types';
import { BookingRequestStatus } from '../../types/enums';

// The backend's 409 for a second active request on the same car, word for
// word (booking-requests.service.ts DUPLICATE_ACTIVE_BOOKING) — the fallback
// when the response carries no message of its own.
export const DUPLICATE_ACTIVE_BOOKING_MESSAGE = 'You already have an active inquiry for this vehicle';

/**
 * What the inquiry form shows when POST /booking-requests fails: the server's
 * message, and whether it was the "already have an active inquiry" 409 (the
 * only conflict that endpoint returns) so the form can point to the inquiry.
 * Booking the same car again is fine once the earlier request is COMPLETED,
 * CANCELLED, REJECTED or NOT_STARTED.
 */
export function createBookingError(error: NormalizedApiError): { message: string; duplicate: boolean } {
  if (error.kind === 'conflict') {
    return { message: error.message || DUPLICATE_ACTIVE_BOOKING_MESSAGE, duplicate: true };
  }
  return { message: error.message, duplicate: false };
}

/** A line explaining a status the badge alone doesn't, or null. */
export function bookingStatusExplanation(status: BookingRequestStatus): string | null {
  if (status === BookingRequestStatus.NOT_STARTED) {
    return 'The booked period ended without the rental being started. You can send a new inquiry for this car.';
  }
  return null;
}

/**
 * The assigned driver the booking detail shows before the rental starts
 * (ACCEPTED). While IN_PROGRESS the live driver card shows them instead.
 * `phone` is null until the driver accepts the job (backend D14) — Call and
 * WhatsApp are hidden then.
 */
export function upcomingRentalDriver(
  booking: Pick<BookingRequest, 'status' | 'assignedDriver'>,
): { name: string; phone: string | null } | null {
  if (booking.status !== BookingRequestStatus.ACCEPTED || !booking.assignedDriver) return null;
  return { name: booking.assignedDriver.name, phone: booking.assignedDriver.phone || null };
}
