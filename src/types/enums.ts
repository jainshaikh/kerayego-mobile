// Mirrors backend enums exactly — keep in sync with kerayego-backend/prisma/schema.prisma

export enum Role {
  USER = 'USER',
  PROVIDER = 'PROVIDER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
}

export enum ProviderStatus {
  PENDING = 'PENDING',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum VehicleStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ARCHIVED = 'ARCHIVED',
}

export enum BookingRequestStatus {
  PENDING = 'PENDING',
  CONTACTED = 'CONTACTED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export enum RentalDurationType {
  HOURS_6 = 'HOURS_6',
  HOURS_12 = 'HOURS_12',
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

export enum DocumentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum DocumentType {
  BUSINESS_LICENSE = 'BUSINESS_LICENSE',
  TRADE_LICENSE = 'TRADE_LICENSE',
  OWNERSHIP_PROOF = 'OWNERSHIP_PROOF',
  ID_DOCUMENT = 'ID_DOCUMENT',
  DRIVING_LICENSE = 'DRIVING_LICENSE',
  VEHICLE_REGISTRATION = 'VEHICLE_REGISTRATION',
  VEHICLE_INSURANCE = 'VEHICLE_INSURANCE',
  OTHER = 'OTHER',
}

export enum Transmission {
  AUTOMATIC = 'AUTOMATIC',
  MANUAL = 'MANUAL',
  CVT = 'CVT',
}

export enum FuelType {
  PETROL = 'PETROL',
  DIESEL = 'DIESEL',
  ELECTRIC = 'ELECTRIC',
  HYBRID = 'HYBRID',
  CNG = 'CNG',
}

export enum TripStatus {
  PENDING_REVIEW = 'PENDING_REVIEW', // legacy value, current backend publishes trips immediately
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED', // legacy value
  CANCELLED = 'CANCELLED',
  IN_PROGRESS = 'IN_PROGRESS', // driver tapped Start Trip
  COMPLETED = 'COMPLETED',
  SUSPENDED = 'SUSPENDED',
}

export enum TripEventType {
  START = 'START',
  ARRIVED = 'ARRIVED',
  PICKUP = 'PICKUP',
  NO_SHOW = 'NO_SHOW',
  DROPOFF = 'DROPOFF',
  END = 'END',
}

export enum PickupSource {
  DRIVER_TAP = 'DRIVER_TAP',
  AUTO_ON_TRIP_END = 'AUTO_ON_TRIP_END',
}

export enum UserVehicleStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum TripInquiryStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

// ─── Centralized display mapping (do not repeat status strings in screens) ──
// Tone families mirror the web app's components/common/StatusBadge.tsx exactly
// (amber=warning, blue=info, emerald=success, red=danger, slate=neutral,
// violet=accent, teal=complete) so status colors read identically on both clients.

export type StatusTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'danger'
  | 'warning'
  | 'accent'
  | 'complete';

export const bookingStatusMeta: Record<
  BookingRequestStatus,
  { label: string; tone: StatusTone }
> = {
  [BookingRequestStatus.PENDING]: { label: 'Pending', tone: 'warning' },
  [BookingRequestStatus.CONTACTED]: { label: 'Contacted', tone: 'accent' },
  [BookingRequestStatus.ACCEPTED]: { label: 'Accepted', tone: 'success' },
  [BookingRequestStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
  [BookingRequestStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
  [BookingRequestStatus.COMPLETED]: { label: 'Completed', tone: 'complete' },
};

export const vehicleStatusMeta: Record<
  VehicleStatus,
  { label: string; tone: StatusTone }
> = {
  [VehicleStatus.DRAFT]: { label: 'Draft', tone: 'neutral' },
  [VehicleStatus.PENDING_REVIEW]: { label: 'Under Review', tone: 'info' },
  [VehicleStatus.APPROVED]: { label: 'Approved', tone: 'success' },
  [VehicleStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
  [VehicleStatus.ARCHIVED]: { label: 'Archived', tone: 'neutral' },
};

// Backend BOOKING_TRANSITIONS (common/enums/booking-status.enum.ts) — mirrored here
// so the mobile UI only ever shows actions the backend will actually accept.
export const BOOKING_TRANSITIONS: Record<
  BookingRequestStatus,
  {
    allowedBy: ('USER' | 'PROVIDER' | 'ADMIN')[];
    nextStates: BookingRequestStatus[];
  }
> = {
  [BookingRequestStatus.PENDING]: {
    allowedBy: ['USER', 'PROVIDER', 'ADMIN'],
    nextStates: [
      BookingRequestStatus.CONTACTED,
      BookingRequestStatus.REJECTED,
      BookingRequestStatus.CANCELLED,
    ],
  },
  [BookingRequestStatus.CONTACTED]: {
    allowedBy: ['PROVIDER', 'ADMIN'],
    nextStates: [BookingRequestStatus.ACCEPTED, BookingRequestStatus.REJECTED],
  },
  [BookingRequestStatus.ACCEPTED]: {
    allowedBy: ['ADMIN'],
    nextStates: [
      BookingRequestStatus.COMPLETED,
      BookingRequestStatus.CANCELLED,
    ],
  },
  [BookingRequestStatus.REJECTED]: { allowedBy: [], nextStates: [] },
  [BookingRequestStatus.CANCELLED]: { allowedBy: [], nextStates: [] },
  [BookingRequestStatus.COMPLETED]: { allowedBy: [], nextStates: [] },
};

/** Actions a USER may take from a given booking status (mirrors backend, minus ADMIN-only moves). */
export function userBookingActions(
  status: BookingRequestStatus,
): BookingRequestStatus[] {
  if (status !== BookingRequestStatus.PENDING) return [];
  return [BookingRequestStatus.CANCELLED];
}

export const tripStatusMeta: Record<
  TripStatus,
  { label: string; tone: StatusTone }
> = {
  [TripStatus.PENDING_REVIEW]: { label: 'Under Review', tone: 'info' },
  [TripStatus.ACTIVE]: { label: 'Active', tone: 'success' },
  [TripStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
  [TripStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
  [TripStatus.IN_PROGRESS]: { label: 'In progress', tone: 'info' },
  [TripStatus.COMPLETED]: { label: 'Completed', tone: 'complete' },
  [TripStatus.SUSPENDED]: { label: 'Suspended', tone: 'danger' },
};

export const userVehicleStatusMeta: Record<
  UserVehicleStatus,
  { label: string; tone: StatusTone }
> = {
  [UserVehicleStatus.PENDING_REVIEW]: { label: 'Under Review', tone: 'info' },
  [UserVehicleStatus.APPROVED]: { label: 'Approved', tone: 'success' },
  [UserVehicleStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
  [UserVehicleStatus.SUSPENDED]: { label: 'Suspended', tone: 'danger' },
};

/** A trip can only be edited/cancelled by its poster while it's still ACTIVE (mirrors backend). */
export function tripPosterActions(
  status: TripStatus,
): ('edit' | 'cancel' | 'start' | 'end')[] {
  if (status === TripStatus.ACTIVE) return ['edit', 'cancel', 'start'];
  if (status === TripStatus.IN_PROGRESS) return ['end'];
  return [];
}

export const tripInquiryStatusMeta: Record<
  TripInquiryStatus,
  { label: string; tone: StatusTone }
> = {
  [TripInquiryStatus.PENDING]: { label: 'Awaiting response', tone: 'warning' },
  [TripInquiryStatus.ACCEPTED]: { label: 'Accepted', tone: 'success' },
  [TripInquiryStatus.REJECTED]: { label: 'Not accepted', tone: 'danger' },
  [TripInquiryStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
  [TripInquiryStatus.EXPIRED]: { label: 'Expired', tone: 'neutral' },
};

// Unlike BookingRequest, a trip's poster can be a plain USER (any user may post
// a trip), so this is identity-based rather than role-based — mirrors the
// backend's TripInquiriesService authorization exactly. A confirmed
// (ACCEPTED) seat can still be cancelled by the rider — it frees the seat and
// notifies the poster; the backend blocks it once the trip has departed.
export function tripInquiryRiderActions(
  status: TripInquiryStatus,
): TripInquiryStatus[] {
  if (
    status === TripInquiryStatus.PENDING ||
    status === TripInquiryStatus.ACCEPTED
  ) {
    return [TripInquiryStatus.CANCELLED];
  }
  return [];
}

export function tripInquiryPosterActions(
  status: TripInquiryStatus,
): TripInquiryStatus[] {
  return status === TripInquiryStatus.PENDING
    ? [TripInquiryStatus.ACCEPTED, TripInquiryStatus.REJECTED]
    : [];
}
