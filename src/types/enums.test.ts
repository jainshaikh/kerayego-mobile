import { describe, expect, it } from '@jest/globals';

import {
  BOOKING_TRANSITIONS,
  BookingRequestStatus,
  bookingStatusMeta,
  canOwnerEditUserVehicle,
  DocumentStatus,
  DocumentType,
  Market,
  PickupSource,
  TripEventType,
  TripInquiryStatus,
  tripInquiryPosterActions,
  tripInquiryRiderActions,
  tripInquiryStatusMeta,
  tripPosterActions,
  TripStatus,
  tripStatusMeta,
  userBookingActions,
  UserVehicleStatus,
  userVehicleStatusMeta,
  VehicleStatus,
  vehicleStatusMeta,
} from './enums';

// ─── Backend fixtures ────────────────────────────────────────────────────────
// Hand-copied from kerayego-backend — there is no shared package or codegen
// between the repos, so when a backend rule changes, update the fixture here
// first and let the failing test point at the mobile helper to fix.

// prisma/schema.prisma enum values (ride state machine only).
const BACKEND_ENUM_VALUES = {
  TripStatus: ['PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED', 'SUSPENDED'],
  TripInquiryStatus: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  TripEventType: ['START', 'ARRIVED', 'PICKUP', 'NO_SHOW', 'DROPOFF', 'END'],
  PickupSource: ['DRIVER_TAP', 'AUTO_ON_TRIP_END'],
  UserVehicleStatus: ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'],
  BookingRequestStatus: ['PENDING', 'CONTACTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED'],
  Market: ['PK', 'SA', 'AE'],
  DocumentStatus: ['PENDING', 'APPROVED', 'REJECTED'],
  DocumentType: [
    'BUSINESS_LICENSE',
    'TRADE_LICENSE',
    'OWNERSHIP_PROOF',
    'ID_DOCUMENT',
    'ID_DOCUMENT_FRONT',
    'ID_DOCUMENT_BACK',
    'DRIVING_LICENSE',
    'VEHICLE_REGISTRATION',
    'VEHICLE_INSURANCE',
    'OTHER',
  ],
};

// user-vehicles.service.ts OWNER_EDITABLE_USER_VEHICLE_STATUSES: the statuses
// PATCH /my/vehicles/:id accepts (anything else is a 409).
const BACKEND_OWNER_EDITABLE_USER_VEHICLE_STATUSES = [UserVehicleStatus.REJECTED, UserVehicleStatus.PENDING_REVIEW];

// src/common/enums/trip-inquiry-status.enum.ts TRIP_INQUIRY_NEXT_STATES.
const BACKEND_TRIP_INQUIRY_NEXT_STATES: Record<TripInquiryStatus, TripInquiryStatus[]> = {
  [TripInquiryStatus.PENDING]: [
    TripInquiryStatus.ACCEPTED,
    TripInquiryStatus.REJECTED,
    TripInquiryStatus.CANCELLED,
    TripInquiryStatus.EXPIRED,
  ],
  [TripInquiryStatus.ACCEPTED]: [TripInquiryStatus.CANCELLED],
  [TripInquiryStatus.REJECTED]: [],
  [TripInquiryStatus.CANCELLED]: [],
  [TripInquiryStatus.EXPIRED]: [],
};

// TripInquiriesService.updateStatus identity rules: only the rider may
// CANCEL, only the trip's poster may ACCEPT/REJECT. EXPIRED is cron-only
// (UpdateTripInquiryStatusDto's USER_SETTABLE_TRIP_INQUIRY_STATUSES omits it).
const BACKEND_RIDER_SETTABLE = [TripInquiryStatus.CANCELLED];
const BACKEND_POSTER_SETTABLE = [TripInquiryStatus.ACCEPTED, TripInquiryStatus.REJECTED];

// trip-inquiries.service.ts SEAT_CANCEL_BLOCKED_TRIP_STATUSES: a rider can't
// cancel a confirmed seat once its trip is over, called off or taken down
// (a 409). PENDING requests aren't gated on the trip's status.
const BACKEND_SEAT_CANCEL_BLOCKED_TRIP_STATUSES = [TripStatus.COMPLETED, TripStatus.CANCELLED, TripStatus.SUSPENDED];

// TripsService status gates for the poster's own trip: update, cancel and
// startTrip require ACTIVE; endTrip requires IN_PROGRESS.
const BACKEND_TRIP_ACTION_REQUIRES: Record<'edit' | 'cancel' | 'start' | 'end', TripStatus> = {
  edit: TripStatus.ACTIVE,
  cancel: TripStatus.ACTIVE,
  start: TripStatus.ACTIVE,
  end: TripStatus.IN_PROGRESS,
};

// src/common/enums/booking-status.enum.ts BOOKING_TRANSITIONS.
const BACKEND_BOOKING_TRANSITIONS: typeof BOOKING_TRANSITIONS = {
  [BookingRequestStatus.PENDING]: {
    allowedBy: ['USER', 'PROVIDER', 'ADMIN'],
    nextStates: [BookingRequestStatus.CONTACTED, BookingRequestStatus.REJECTED, BookingRequestStatus.CANCELLED],
  },
  [BookingRequestStatus.CONTACTED]: {
    allowedBy: ['PROVIDER', 'ADMIN'],
    nextStates: [BookingRequestStatus.ACCEPTED, BookingRequestStatus.REJECTED],
  },
  [BookingRequestStatus.ACCEPTED]: {
    allowedBy: ['ADMIN'],
    nextStates: [BookingRequestStatus.COMPLETED, BookingRequestStatus.CANCELLED],
  },
  [BookingRequestStatus.REJECTED]: { allowedBy: [], nextStates: [] },
  [BookingRequestStatus.CANCELLED]: { allowedBy: [], nextStates: [] },
  [BookingRequestStatus.COMPLETED]: { allowedBy: [], nextStates: [] },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('enum mirrors', () => {
  const mirrors: [keyof typeof BACKEND_ENUM_VALUES, Record<string, string>][] = [
    ['TripStatus', TripStatus],
    ['TripInquiryStatus', TripInquiryStatus],
    ['TripEventType', TripEventType],
    ['PickupSource', PickupSource],
    ['UserVehicleStatus', UserVehicleStatus],
    ['BookingRequestStatus', BookingRequestStatus],
    ['Market', Market],
    ['DocumentStatus', DocumentStatus],
    ['DocumentType', DocumentType],
  ];

  it.each(mirrors)('%s matches the backend Prisma enum', (name, mobileEnum) => {
    expect(Object.values(mobileEnum).sort()).toEqual([...BACKEND_ENUM_VALUES[name]].sort());
  });

  it('BOOKING_TRANSITIONS matches the backend table', () => {
    expect(BOOKING_TRANSITIONS).toEqual(BACKEND_BOOKING_TRANSITIONS);
  });
});

describe('status display meta', () => {
  const metas: [string, Record<string, string>, Record<string, { label: string }>][] = [
    ['tripStatusMeta', TripStatus, tripStatusMeta],
    ['tripInquiryStatusMeta', TripInquiryStatus, tripInquiryStatusMeta],
    ['bookingStatusMeta', BookingRequestStatus, bookingStatusMeta],
    ['vehicleStatusMeta', VehicleStatus, vehicleStatusMeta],
    ['userVehicleStatusMeta', UserVehicleStatus, userVehicleStatusMeta],
  ];

  it.each(metas)('%s has a non-empty label for every status', (_name, statusEnum, meta) => {
    for (const status of Object.values(statusEnum)) {
      expect(meta[status]?.label).toEqual(expect.any(String));
      expect(meta[status].label.length).toBeGreaterThan(0);
    }
  });
});

describe('tripPosterActions', () => {
  it.each(Object.values(TripStatus))('offers exactly the actions the backend accepts from %s', (status) => {
    const expected = (Object.keys(BACKEND_TRIP_ACTION_REQUIRES) as (keyof typeof BACKEND_TRIP_ACTION_REQUIRES)[])
      .filter((action) => BACKEND_TRIP_ACTION_REQUIRES[action] === status);
    expect([...tripPosterActions(status)].sort()).toEqual(expected.sort());
  });

  it('gives an ACTIVE trip edit, cancel and start, and an IN_PROGRESS trip only end', () => {
    expect(tripPosterActions(TripStatus.ACTIVE)).toEqual(['edit', 'cancel', 'start']);
    expect(tripPosterActions(TripStatus.IN_PROGRESS)).toEqual(['end']);
  });
});

describe('trip inquiry actions', () => {
  const allowed = (status: TripInquiryStatus, settable: TripInquiryStatus[]) =>
    BACKEND_TRIP_INQUIRY_NEXT_STATES[status].filter((next) => settable.includes(next));

  it.each(Object.values(TripInquiryStatus))('rider actions from %s match the backend', (status) => {
    expect([...tripInquiryRiderActions(status)].sort()).toEqual(allowed(status, BACKEND_RIDER_SETTABLE).sort());
  });

  it.each(Object.values(TripInquiryStatus))('poster actions from %s match the backend', (status) => {
    expect([...tripInquiryPosterActions(status)].sort()).toEqual(allowed(status, BACKEND_POSTER_SETTABLE).sort());
  });

  it('lets a rider cancel a confirmed (ACCEPTED) seat', () => {
    expect(tripInquiryRiderActions(TripInquiryStatus.ACCEPTED)).toEqual([TripInquiryStatus.CANCELLED]);
  });

  it.each(Object.values(TripStatus))('lets a rider cancel a confirmed seat on a %s trip only where the backend does', (tripStatus) => {
    expect(tripInquiryRiderActions(TripInquiryStatus.ACCEPTED, tripStatus)).toEqual(
      BACKEND_SEAT_CANCEL_BLOCKED_TRIP_STATUSES.includes(tripStatus) ? [] : [TripInquiryStatus.CANCELLED],
    );
  });

  it('keeps seat cancel available while the trip is IN_PROGRESS (owner decision; the backend allows it)', () => {
    expect(tripInquiryRiderActions(TripInquiryStatus.ACCEPTED, TripStatus.IN_PROGRESS)).toEqual([
      TripInquiryStatus.CANCELLED,
    ]);
  });

  it.each(Object.values(TripStatus))('lets a rider withdraw a PENDING request whatever the trip status (%s)', (tripStatus) => {
    expect(tripInquiryRiderActions(TripInquiryStatus.PENDING, tripStatus)).toEqual([TripInquiryStatus.CANCELLED]);
  });

  it('never offers EXPIRED to anyone', () => {
    for (const status of Object.values(TripInquiryStatus)) {
      expect(tripInquiryRiderActions(status)).not.toContain(TripInquiryStatus.EXPIRED);
      expect(tripInquiryPosterActions(status)).not.toContain(TripInquiryStatus.EXPIRED);
    }
  });
});

describe('userBookingActions', () => {
  it.each(Object.values(BookingRequestStatus))('from %s only offers moves the backend lets a USER make', (status) => {
    const transition = BACKEND_BOOKING_TRANSITIONS[status];
    for (const next of userBookingActions(status)) {
      expect(transition.allowedBy).toContain('USER');
      expect(transition.nextStates).toContain(next);
    }
  });

  it('only ever offers cancelling a PENDING booking', () => {
    // Narrower than the backend table, whose PENDING row also lets a USER
    // reach CONTACTED/REJECTED — the app only surfaces cancel.
    for (const status of Object.values(BookingRequestStatus)) {
      expect(userBookingActions(status)).toEqual(
        status === BookingRequestStatus.PENDING ? [BookingRequestStatus.CANCELLED] : [],
      );
    }
  });
});

describe('canOwnerEditUserVehicle', () => {
  it.each(Object.values(UserVehicleStatus))('matches the backend owner-edit gate for %s', (status) => {
    expect(canOwnerEditUserVehicle(status)).toBe(BACKEND_OWNER_EDITABLE_USER_VEHICLE_STATUSES.includes(status));
  });
});
