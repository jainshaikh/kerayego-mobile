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

export interface RentalDriverCardInfo {
  name: string;
  avatarUrl: string | null;
  // Shown as "Identity verified" / "Licence verified" — never "safe" (A86).
  identityVerified: boolean;
  licenceVerified: boolean;
  rating: { average: number | null; count: number } | null;
  rideCount: number;
  // Call / WhatsApp: only while ACCEPTED and the backend sends the phone (D14:
  // null until the driver accepts the job). While IN_PROGRESS the live driver
  // card has the buttons; after the rental, nobody needs them.
  contactPhone: string | null;
  // ACCEPTED with no phone yet: "You can call your driver once they confirm the job."
  waitingForConfirmation: boolean;
}

const DRIVER_CARD_STATUSES: readonly BookingRequestStatus[] = [
  BookingRequestStatus.ACCEPTED,
  BookingRequestStatus.IN_PROGRESS,
  BookingRequestStatus.COMPLETED,
];

/**
 * The driver card the booking detail shows once a driver is assigned (A86):
 * photo, name, rating, rides and what KerayeGo checked — while the booking is
 * ACCEPTED, IN_PROGRESS or COMPLETED. Null otherwise.
 */
export function rentalDriverCard(
  booking: Pick<BookingRequest, 'status' | 'assignedDriver'>,
): RentalDriverCardInfo | null {
  const driver = booking.assignedDriver;
  if (!driver || !DRIVER_CARD_STATUSES.includes(booking.status)) return null;
  const accepted = booking.status === BookingRequestStatus.ACCEPTED;
  const phone = driver.phone || null;
  return {
    name: driver.name,
    avatarUrl: driver.avatarUrl ?? null,
    identityVerified: driver.identityVerified === true,
    licenceVerified: driver.licenceVerified === true,
    rating: driver.rating ?? null,
    rideCount: driver.rideCount ?? 0,
    contactPhone: accepted ? phone : null,
    waitingForConfirmation: accepted && !phone,
  };
}
