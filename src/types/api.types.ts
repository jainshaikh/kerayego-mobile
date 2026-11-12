import type {
  BookingRequestStatus,
  BookingTripType,
  DocumentStatus,
  FuelType,
  Market,
  ProviderStatus,
  RentalDurationType,
  Role,
  Transmission,
  TripStatus,
  UserStatus,
  UserVehicleStatus,
  VehicleStatus,
} from './enums';

// ─── API Envelope ────────────────────────────────────────────────────────────
// Backend TransformInterceptor wraps every response as { success: true, data, message?, meta? }.
// Message-only endpoints (register/code-request/logout/verify-email) do NOT
// return a top-level `message` — the whole { message } object gets nested under `data` instead,
// because the controller's own object had no `data` key for the interceptor to unwrap.
// Type each endpoint's response according to what the controller actually returns (see auth.api.ts).

export interface ApiResponse<T> {
  success: true;
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  statusCode: number;
  error: {
    code: string;
    message: string;
    // A validation error's field list, or — on a coded error — an object of
    // its own (e.g. ROUTE_DOES_NOT_FIT's { suggestion, distanceKm, … }).
    details?: { field?: string; message: string }[] | Record<string, unknown>;
  };
  timestamp: string;
  path: string;
}

// Basic pagination meta — Users / Providers / Booking Requests listings
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Extended pagination meta — Vehicles (provider) / public Listings
export interface PaginationMetaExtended extends PaginationMeta {
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// ─── User ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  // True while KerayeGo checks the account (a phone number matched a blocked
  // person): browsing works, but booking, posting trips, requesting seats and
  // driving answer 403 IDENTITY_ON_HOLD. Optional for older backends.
  identityHold?: boolean;
  // WhatsApp phone verification (2026-11). Optional for older backends —
  // treat a missing mustVerifyPhone as false, a missing whatsappUpdates as true.
  // phone !== null and verified by a WhatsApp code.
  phoneVerified?: boolean;
  // The backend's verdict on the gate (its PHONE_VERIFICATION_REQUIRED flag,
  // never ADMIN, phone not verified): true → the blocking "Verify your mobile
  // number" screen. The app never works this out for itself.
  mustVerifyPhone?: boolean;
  // The "WhatsApp updates" setting — booking and trip notifications on
  // WhatsApp (the verification code itself always goes out).
  whatsappUpdates?: boolean;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  // Same as User.identityHold.
  identityHold?: boolean;
  // Same as the User fields of the same names.
  phoneVerified?: boolean;
  mustVerifyPhone?: boolean;
  whatsappUpdates?: boolean;
}

// POST /auth/code/verify (the same session shape the backend's old password
// /auth/login returns).
export interface LoginResult {
  accessToken: string;
  user: AuthUser;
  // True when this sign-in cancelled a pending account deletion (A51) — the
  // app says so once. Optional for older backends.
  deletionCancelled?: boolean;
  // Only present for mobile clients (x-client-type: mobile header) — web relies on the
  // httpOnly cookie instead. See kerayego-backend auth.controller.ts.
  refreshToken?: string;
}

// POST /auth/code/request — always this answer, account or not.
export interface LoginCodeRequestResult {
  message: string;
  resendAfterSeconds: number;
}

// ─── Phone-first sign-in / sign-up (2026-11-06) ─────────────────────────────
// POST /auth/phone/request → /auth/phone/verify → (no account yet)
// /auth/phone/register. Mirrors kerayego-backend's auth phone endpoints.

// "Message us for your code" (2026-11-09), on POST /auth/phone/request and
// POST /users/me/phone/send-code. Both optional — an older backend sends
// neither (treat as codeSent: true, no link).
export interface PhoneCodeByMessage {
  // False: the code template couldn't be sent (Meta hasn't allowed it yet) —
  // the person gets the code by sending messageUsUrl's message; the backend
  // replies with it. True/absent: the code is on its way, as before.
  codeSent?: boolean;
  // A wa.me link with "Send my KerayeGo code" prefilled to KerayeGo's number.
  // Absent: the path is off (and a failed send is still 502 WHATSAPP_SEND_FAILED).
  messageUsUrl?: string;
}

// POST /auth/phone/request — the same answer whether or not the number has an
// account (no account enumeration).
export interface PhoneSignInRequestResult extends PhoneCodeByMessage {
  phone: string; // E.164, e.g. "+923001234567"
  expiresInMinutes: number;
  resendInSeconds: number;
  channel: 'whatsapp';
  // Only when codeSent is false: "Send us a message on WhatsApp and we will
  // reply with your 6-digit code."
  message?: string;
}

// POST /auth/phone/verify (and /auth/phone/register) when it signs in: the
// /auth/code/verify session plus needsSignup: false.
export interface PhoneSignInSession extends LoginResult {
  needsSignup: false;
}

// POST /auth/phone/verify when no account has this number yet: no session —
// the profile step sends signupToken to /auth/phone/register.
export interface PhoneSignupRequired {
  needsSignup: true;
  phone: string; // E.164
  signupToken: string;
  expiresInMinutes: number;
}

export type PhoneVerifyResult = PhoneSignInSession | PhoneSignupRequired;

// Error codes (body.error.code) of the phone sign-in endpoints, besides the
// PhoneErrorCode ones they share (CODE_RESEND_TOO_SOON, CODE_LIMIT_REACHED,
// WHATSAPP_SEND_FAILED, WHATSAPP_UNAVAILABLE, PHONE_TAKEN, and CODE_INVALID —
// a 401 here, unlike /users/me/phone/verify's 400).
export const PhoneAuthErrorCode = {
  /** 401 /auth/phone/register — bad or expired signupToken: back to the number step. */
  SIGNUP_TOKEN_INVALID: 'SIGNUP_TOKEN_INVALID',
  /** 409 /auth/phone/register — the email has an account: sign in with email instead. */
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  /** 403 /auth/phone/register — a blocked email. */
  IDENTITY_BLOCKED: 'IDENTITY_BLOCKED',
} as const;

// POST /users/me/phone/send-code — a code is on its way on WhatsApp, or (no
// send) the number is already this account's verified one.
export type PhoneSendCodeResult =
  | {
      phone: string; // E.164, e.g. "+923001234567"
      expiresInMinutes: number;
      resendInSeconds: number;
      channel: 'whatsapp';
      alreadyVerified?: false;
    } & PhoneCodeByMessage
  | { phone: string; alreadyVerified: true };

// Error codes (body.error.code) of the WhatsApp phone verification endpoints
// and its gate — mirrors kerayego-backend's users/phone-verification code.
export const PhoneErrorCode = {
  /** 409 send-code / verify — another account has verified this number. */
  PHONE_TAKEN: 'PHONE_TAKEN',
  /** 429 send-code — within 60 s of the last code; carries retryAfterSeconds. */
  CODE_RESEND_TOO_SOON: 'CODE_RESEND_TOO_SOON',
  /** 429 send-code — 10 codes in 24 h for this account. */
  CODE_LIMIT_REACHED: 'CODE_LIMIT_REACHED',
  /**
   * 502 send-code — Meta refused the message (its message says what to do).
   * With "message us for your code" on, the backend answers 200 codeSent:
   * false instead.
   */
  WHATSAPP_SEND_FAILED: 'WHATSAPP_SEND_FAILED',
  /** 503 send-code — WhatsApp isn't set up on the server. */
  WHATSAPP_UNAVAILABLE: 'WHATSAPP_UNAVAILABLE',
  /**
   * 400 /users/me/phone/verify — wrong or expired code (400, never 401: no
   * token refresh). /auth/phone/verify answers 401 CODE_INVALID instead.
   */
  CODE_INVALID: 'CODE_INVALID',
  /** 403 from any gated endpoint while user.mustVerifyPhone. */
  PHONE_NOT_VERIFIED: 'PHONE_NOT_VERIFIED',
} as const;

export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
}

// ─── Provider ───────────────────────────────────────────────────────────────

export interface ProviderProfile {
  id: string;
  userId: string;
  businessName: string;
  slug: string;
  businessDescription: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  verificationStatus: ProviderStatus;
  rejectionReason: string | null;
  isFeatured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Showroom {
  id: string;
  providerProfileId: string;
  name: string;
  address: string;
  city: string;
  area: string | null;
  contactNumber: string;
  whatsappNumber: string | null;
  operatingHours: Record<string, string> | null;
  mapLat: number | null;
  mapLng: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UploadedDocument {
  id: string;
  documentType: string;
  fileUrl: string;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
}

export interface CompletenessScore {
  score: number;
  missing: string[];
  total: number;
  passed: number;
}

export interface ProviderProfileWithMeta extends ProviderProfile {
  showrooms: Showroom[];
  documents: UploadedDocument[];
  _count?: { vehicles: number; bookingRequests: number };
  completenessScore: CompletenessScore;
  emailVerified: boolean;
}

export interface PublicProviderCard {
  id: string;
  businessName: string;
  slug: string;
  logoUrl: string | null;
  businessDescription: string | null;
  isFeatured: boolean;
  showrooms: {
    city: string;
    area: string | null;
    mapLat: number | null;
    mapLng: number | null;
  }[];
  _count: { vehicles: number };
  // Only present when the request included lat/lng (nearby search) — computed
  // from the provider's first showroom (by createdAt), mirrors web exactly.
  distanceKm?: number;
}

export interface PublicProviderDetail {
  id: string;
  businessName: string;
  slug: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  businessDescription: string | null;
  isFeatured: boolean;
  verificationStatus: ProviderStatus;
  showrooms: Showroom[];
  vehicles: {
    id: string;
    slug: string;
    title: string;
    make: string;
    model: string;
    year: number;
    pricePerDay: string;
    transmission: Transmission;
    fuelType: FuelType;
    images: { url: string; altText: string | null }[];
  }[];
  _count: { vehicles: number };
}

// ─── Vehicle ────────────────────────────────────────────────────────────────

export interface VehicleImage {
  id: string;
  url: string;
  publicId: string;
  altText: string | null;
  sortOrder: number;
  width: number | null;
  height: number | null;
}

export interface VehicleFeature {
  id: string;
  name: string;
  value: string | null;
}

// Full vehicle shape returned to the owning provider
export interface ProviderVehicle {
  id: string;
  slug: string;
  title: string;
  make: string;
  model: string;
  year: number;
  transmission: Transmission;
  fuelType: FuelType;
  seatingCapacity: number;
  engineType: string | null;
  pricePerDay: string;
  pricePerWeek: string | null;
  locationText: string | null;
  availabilityNotes: string | null;
  pricingNotes: string | null;
  specialConditions: string | null;
  status: VehicleStatus;
  rejectionReason: string | null;
  viewCount: number;
  inquiryCount: number;
  showroomId: string | null;
  images: VehicleImage[];
  features: VehicleFeature[];
  showroom: {
    id: string;
    name: string;
    city: string;
    area: string | null;
    contactNumber: string;
  } | null;
  _count?: { bookingRequests: number };
  createdAt: string;
  updatedAt: string;
}

// "This exact car" (A87): the car's own figures across its plate (every
// listing of it, any owner) — the same as GET /reviews/summary for VEHICLE.
export interface CarRating {
  averageRating: number | null;
  reviewCount: number;
  rideCount: number;
}

// Public listing card (GET /listings, saved vehicles). No week or month
// prices since 2026-11-11 (A79): weeks and months are "price to agree" on
// cars with offersWeeklyMonthly (A84).
export interface VehicleCard {
  id: string;
  slug: string;
  title: string;
  make: string;
  model: string;
  year: number;
  pricePer6Hours?: string | null;
  pricePer12Hours?: string | null;
  pricePerDay: string;
  // Optional: absent from an older backend.
  offersWeeklyMonthly?: boolean;
  carRating?: CarRating;
  transmission: Transmission;
  fuelType: FuelType;
  seatingCapacity: number;
  status: VehicleStatus;
  locationText: string | null;
  images: { url: string; altText: string | null; sortOrder: number }[];
  providerProfile: { businessName: string; slug: string };
  showroom: {
    city: string;
    area: string | null;
    mapLat: number | null;
    mapLng: number | null;
  } | null;
  // Only present when the request included lat/lng (nearby search).
  distanceKm?: number;
}

// Public listing detail (GET /listings/:slug)
export interface VehicleDetail {
  id: string;
  slug: string;
  title: string;
  make: string;
  model: string;
  year: number;
  pricePer6Hours: string | null;
  pricePer12Hours: string | null;
  pricePerDay: string;
  // No week or month prices (A79) — see VehicleCard. Optional for an older backend.
  offersWeeklyMonthly?: boolean;
  carRating?: CarRating;
  transmission: Transmission;
  fuelType: FuelType;
  seatingCapacity: number;
  engineType: string | null;
  locationText: string | null;
  availabilityNotes: string | null;
  pricingNotes: string | null;
  specialConditions: string | null;
  status: VehicleStatus;
  viewCount: number;
  inquiryCount: number;
  images: {
    id: string;
    url: string;
    altText: string | null;
    sortOrder: number;
    width: number | null;
    height: number | null;
  }[];
  features: VehicleFeature[];
  providerProfile: {
    id: string;
    businessName: string;
    slug: string;
    logoUrl: string | null;
    verificationStatus: ProviderStatus;
  };
  showroom: Showroom | null;
}

// ─── Booking Requests ───────────────────────────────────────────────────────

export interface BookingStatusHistoryEntry {
  id: string;
  oldStatus: BookingRequestStatus;
  newStatus: BookingRequestStatus;
  note: string | null;
  createdAt: string;
}

// One pickup or drop-off of a rental request (plan §3c, A75), in route order
// (every pickup, then every drop-off). `expectedAt` = pickup time + driving +
// 15 min per earlier stop + breaks (A78); null after a missing leg, and on
// week/month requests (no route).
export interface BookingStop {
  id: string;
  type: 'PICKUP' | 'DROPOFF';
  sortOrder: number;
  label: string;
  lat: number;
  lng: number;
  city: string | null;
  note: string | null;
  // The drive from the stop before — null on the first stop.
  legDistanceKm: number | null;
  legDurationMinutes: number | null;
  expectedAt: string | null;
}

export interface BookingRequest {
  id: string;
  status: BookingRequestStatus;
  requestedFromDate: string;
  requestedToDate: string; // server-derived from durationType/durationQuantity
  durationType: RentalDurationType;
  durationQuantity: number;
  // Server-derived: the car's price × the count. Null for a week or month
  // request — "price to agree" (A79).
  totalPrice: string | null;
  // Free text on old requests; on new ones the server fills it from the first
  // pickup (and dropoffLocation from the last drop-off).
  pickupLocation: string | null;
  dropoffLocation?: string | null;
  // ── Rental booking redesign (2026-11-11, plan §3c) — null / [] on older
  // requests, absent from an older backend.
  tripType?: BookingTripType | null;
  passengerCount?: number | null;
  // The customer's route — a round trip including the way back.
  routeDistanceKm?: number | null;
  routeDurationMinutes?: number | null;
  wayBackDistanceKm?: number | null;
  wayBackDurationMinutes?: number | null;
  // Driving + 15 min per stop after the first + 30 min per full 4 h (A80).
  timeNeededMinutes?: number | null;
  // Week/month requests (A85).
  driverHoursPerDay?: number | null;
  daysPerWeek?: number | null;
  kmPerMonth?: number | null;
  stops?: BookingStop[];
  message: string | null;
  providerNotes: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string; email: string; phone: string | null };
  vehicle: {
    id: string;
    title: string;
    slug: string;
    make: string;
    model: string;
    year: number;
    pricePerDay: string;
    images: { url: string; altText: string | null }[];
  };
  providerProfile: { id: string; businessName: string };
  statusHistory: BookingStatusHistoryEntry[];
  // The business's driver for this rental, once assigned. For the customer
  // `phone` is null unless the booking is IN_PROGRESS, or ACCEPTED with the
  // driver having accepted the job (backend D14) — hide Call/WhatsApp then.
  // Optional: absent from an older backend.
  assignedDriver?: {
    id: string;
    name: string;
    avatarUrl: string | null;
    phone: string | null;
    // The driver card (A86), on the customer's responses only — optional for
    // an older backend. Word them "Identity verified" / "Licence verified",
    // never "safe".
    identityVerified?: boolean;
    licenceVerified?: boolean;
    // The driver's public rating across their CNIC identity (A24).
    rating?: { average: number | null; count: number };
    // Completed rental jobs as the assigned driver + carpool trips they drove.
    rideCount?: number;
  } | null;
  // The driver's answer to the job: PENDING / ACCEPTED / DECLINED, null when
  // no driver is assigned.
  driverJobStatus?: 'PENDING' | 'ACCEPTED' | 'DECLINED' | null;
}

// ─── Rental request estimate (POST /booking-requests/estimate, A77, A78) ────

// A priced package and how the route fits it (A80). DAY's durationQuantity is
// the fewest days the driving needs (at most 6).
export interface RentalPackageFit {
  durationType: RentalDurationType;
  durationQuantity: number;
  fits: boolean;
  // Hour packages: the package minus the time needed. Days: 10 h × days minus
  // the driving. Negative when it doesn't fit.
  spareMinutes: number;
  endsAt: string;
  // Round trip only: what the package leaves at the destination after both drives.
  timeAtDestinationMinutes: number | null;
}

export interface RentalPackageChoice {
  durationType: RentalDurationType;
  durationQuantity: number;
}

export interface BookingEstimate {
  vehicleId: string;
  tripType: BookingTripType;
  requestedFromDate: string;
  route: {
    distanceKm: number;
    drivingMinutes: number;
    timeNeededMinutes: number;
    // Round trip: the last drop-off back through the pickups (inside the totals).
    wayBack: { distanceKm: number; durationMinutes: number } | null;
    // The stops in route order — no ids (nothing is stored).
    stops: Omit<BookingStop, 'id'>[];
  };
  // Each priced package the car offers, shortest first.
  packages: RentalPackageFit[];
  // The smallest package the car offers that fits; null = too long for every one.
  suggestion: RentalPackageChoice | null;
  // How the package sent with the estimate fits; null when none was sent.
  selected: RentalPackageFit | null;
}

// Error codes (body.error.code) of POST /booking-requests and /estimate.
export const BookingErrorCode = {
  /** 400 — `error.details { suggestion, distanceKm, drivingMinutes, timeNeededMinutes }`. */
  ROUTE_DOES_NOT_FIT: 'ROUTE_DOES_NOT_FIT',
  /** 400 — "Choose a pickup time in the future." */
  START_TIME_PAST: 'START_TIME_PAST',
  /** 400 — not ≥1 pickup and ≥1 drop-off with coordinates, or more than 10 stops. */
  STOPS_INVALID: 'STOPS_INVALID',
  /** 400 — Google found no route through the stops. */
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  /** 503 — Google couldn't be reached; try again. */
  ROUTE_UNAVAILABLE: 'ROUTE_UNAVAILABLE',
  /** 400 — the old place fields sent together with stops (never sent by this app). */
  OLD_REQUEST_SHAPE: 'OLD_REQUEST_SHAPE',
} as const;

// ─── Live location (customer sharing + rental live driver) ──────────────────
// kerayego-backend live-location contract (2026-10-29). The backend alone
// decides when a sharing window is open; these only carry its answers.

export type LocationShareTargetKind = 'TRIP_INQUIRY' | 'BOOKING';

// One sharing window open right now for the signed-in customer: a carpool
// seat (tripInquiryId) or a rental booking (bookingRequestId).
export interface LocationShareTarget {
  kind: LocationShareTargetKind;
  id: string;
  // The customer pressed Stop — the window is open but nothing is shared.
  paused: boolean;
  // trip.departureAt or booking.requestedFromDate (ISO).
  pickupAt: string;
  // "Lahore → Islamabad", or the rental vehicle's title.
  label: string;
  driverName: string | null;
}

// GET /users/me/location-sharing
export interface MyLocationSharing {
  // Every window open now, paused ones included.
  targets: LocationShareTarget[];
  // The earliest not-yet-open window opening within 24 h (ISO), else null —
  // when to check again.
  nextOpensAt: string | null;
}

// POST /trip-inquiries/:id/location, POST /booking-requests/:id/customer-location
export interface CustomerLocationAck {
  lastAcceptedAt: string | null;
}

// PATCH /trip-inquiries/:id/location-sharing,
// PATCH /booking-requests/:id/customer-location-sharing
export interface LocationSharingPauseState {
  paused: boolean;
}

// GET /booking-requests/:id/live-driver (customer only).
export interface BookingLiveDriver {
  // status === IN_PROGRESS.
  isLive: boolean;
  bookingId: string;
  status: BookingRequestStatus;
  startedAt: string | null;
  completedAt: string | null;
  // The driver's newest fix — null unless live and one has arrived.
  lastLocation: {
    lat: number;
    lng: number;
    headingDeg: number | null;
    speedKmh: number | null;
    timestamp: string | null;
  } | null;
  driver: {
    id: string;
    name: string;
    // null unless IN_PROGRESS, or ACCEPTED with the job accepted (D14).
    phone: string | null;
    avatarUrl: string | null;
    verificationStatus: string | null;
  } | null;
  vehicle: {
    id: string;
    title: string;
    make: string;
    model: string;
    year: number;
    images: { url: string; altText: string | null }[];
  };
  // When the driver marked the customer picked up (contract 2026-10-29).
  // Absent from an older backend.
  customerPickedUpAt?: string | null;
}

// GET /booking-requests/:id/live-route — the driver's newest 200 fixes, oldest first.
export interface BookingLiveRouteFix {
  id: string;
  lat: number;
  lng: number;
  headingDeg: number | null;
  speedKmh: number | null;
  timestamp: string;
}

// GET /my/trips/:id/rider-locations (the trip's driver only): riders whose
// window is open, not paused, with a position younger than 15 min.
export interface TripRiderLocation {
  tripInquiryId: string;
  riderId: string;
  riderName: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  at: string;
}

// ─── Saved Vehicles ─────────────────────────────────────────────────────────

export interface SavedVehicle {
  id: string;
  userId: string;
  vehicleId: string;
  createdAt: string;
  vehicle: VehicleCard;
}

// ─── Media ──────────────────────────────────────────────────────────────────

export interface UploadResult {
  id?: string; // present when context=document
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format: string;
  // Documents only (any key in a documents/ folder): a 10-minute signed link to
  // show the file just uploaded. `url` is the file's permanent address in the
  // PRIVATE bucket — send it back with publicId, but it never opens.
  previewUrl?: string;
}

// ─── User Vehicles (personal vehicle, used to post Trips) ───────────────────

// The four verification documents every personal vehicle carries (backend
// USER_VEHICLE_DOCUMENT_TYPES — GET /my/vehicles/:id returns only these).
export type UserVehicleDocumentType = 'ID_DOCUMENT_FRONT' | 'ID_DOCUMENT_BACK' | 'DRIVING_LICENSE' | 'VEHICLE_REGISTRATION';

// A raw UploadedDocument row (ownerType USER_VEHICLE, ownerId = vehicle id).
// The per-document review fields exist in the schema, but today's admin review
// is whole-vehicle, so nothing sets them: a document stays PENDING with no
// reason unless that changes. A replaced document goes back to PENDING.
export interface UserVehicleDocument {
  id: string;
  documentType: UserVehicleDocumentType;
  fileUrl: string;
  // Identifies "the same file" to PATCH /my/vehicles/:id — resending it keeps the document as is.
  publicId: string;
  status: DocumentStatus;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserVehicleImage {
  id: string;
  url: string;
  publicId: string;
  altText: string | null;
  sortOrder: number;
  width: number | null;
  height: number | null;
}

export interface UserVehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  plateNumber: string;
  // Drives the currency of every trip posted with this vehicle (constants/markets.ts).
  country: Market;
  status: UserVehicleStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  // sortOrder 0 is the poster/cover shown as the card thumbnail
  images: UserVehicleImage[];
}

export interface UserVehicleDetail extends UserVehicle {
  documents: UserVehicleDocument[];
  // The owner's CNIC as stored (12345-1234567-1) — owner reads only (GET/PATCH
  // /my/vehicles/:id). Null for a vehicle registered before it was asked for;
  // optional for backends that predate the field.
  cnicNumber?: string | null;
  // The car's history on KerayeGo across its plate (every listing, any owner —
  // GET/PATCH /my/vehicles/:id). Null unless other listings of the plate have
  // rides or reviews; optional for backends that predate the field.
  plateHistory?: PlateHistory | null;
}

// Whole-plate totals (backend VehicleRegisterService.plateHistory). Never says
// who listed the plate before.
export interface PlateHistory {
  rideCount: number;
  reviewCount: number;
  averageRating: number | null;
}

// ─── Trips (intercity, city-to-city) ─────────────────────────────────────────

export interface TripVehicleImage {
  url: string;
  altText: string | null;
}

export interface TripStop {
  id: string;
  type: 'PICKUP' | 'DROPOFF';
  label: string;
  lat: number | null;
  lng: number | null;
  sortOrder: number;
}

export interface TripCard {
  id: string;
  originCity: string;
  destinationCity: string;
  // Legacy primary pickup/dropoff — mirrors the first pickup stop and last
  // dropoff stop in `stops`. Every rider still travels the full route at the
  // flat pricePerSeat; the other stops are just alternate meeting points at
  // each end, not separately bookable legs.
  pickupPoint: string;
  dropoffPoint: string | null;
  stops: TripStop[];
  departureAt: string;
  availableSeats: number;
  pricePerSeat: string;
  contactNumber: string;
  notes: string | null;
  status: TripStatus;
  createdAt: string;
  postedBy: { id: string; name: string };
  // A return trip (isReturnTrip) is a rental business driving one of its
  // fleet cars back after a booking: userVehicle is null then, and
  // fleetVehicle/providerProfile are set instead. Every other trip runs in
  // the poster's own userVehicle, with fleetVehicle/providerProfile null.
  // Read the car through features/trips/tripVehicle.ts, not either field.
  isReturnTrip: boolean;
  userVehicle: {
    id: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    images: TripVehicleImage[];
  } | null;
  fleetVehicle: TripFleetVehicle | null;
  providerProfile: TripProviderProfile | null;
}

// A rental listing (Vehicle) driving a return trip — no colour or plate.
export interface TripFleetVehicle {
  id: string;
  // Listing display title, e.g. "2023 Toyota Camry SE".
  title: string;
  make: string;
  model: string;
  year: number;
  seatingCapacity: number;
  images: TripVehicleImage[];
}

// The rental business behind a return trip.
export interface TripProviderProfile {
  id: string;
  businessName: string;
  slug: string;
  logoUrl: string | null;
  verificationStatus: ProviderStatus;
}

export interface TripDetail extends Omit<TripCard, 'userVehicle' | 'fleetVehicle'> {
  rejectionReason: string | null;
  cancelReason: string | null;
  updatedAt: string;
  // The booking a return trip was posted from; null otherwise.
  returnFromBookingId: string | null;
  userVehicle: {
    id: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    plateNumber: string;
    status: UserVehicleStatus;
    // The market the trip's prices are in (see currencyForMarket).
    country?: Market;
    images: UserVehicleImage[];
  } | null;
  fleetVehicle: (Omit<TripFleetVehicle, 'images'> & {
    status: VehicleStatus;
    images: { id: string; url: string; altText: string | null; sortOrder: number }[];
  }) | null;
}

// ─── Push notification data ──────────────────────────────────────────────────
// The FCM `data` block of a push, as the notification-tap handler receives it
// (features/notifications/pushRouting.ts). Every value is a string.

// Mirrors kerayego-backend src/modules/notifications/ride-push-data.ts. The
// role is relative to THE TRIP, not User.role: the trip's poster is the
// DRIVER, the inquiry's own user the RIDER.
export type PushRecipientRole = 'DRIVER' | 'RIDER';

// The `type` strings of every ride push (RIDE_PUSH_TYPES on the backend) —
// never renamed or removed there, only added to.
export type RidePushType =
  | 'tripInquiry.created'
  | 'tripInquiry.accepted'
  | 'tripInquiry.rejected'
  | 'tripInquiry.cancelled'
  | 'tripInquiry.riderCancelled'
  | 'chat_message'
  | 'trip.started'
  | 'trip.driverArrived'
  | 'trip.droppedOff'
  | 'trip.riderNoShow'
  | 'trip.nextPickupApproaching'
  | 'trip.completed'
  // "Share your location" reminder as the rider's sharing window opens (A44).
  | 'trip.shareLocation';

// A newer backend marks its payloads v: '2' and always sends recipientRole,
// recipientUserId, tripId, tripInquiryId and its legacy mirror inquiryId. An
// older one sent only { type, inquiryId } on tripInquiry.*, { type,
// tripInquiryId, messageId } on chat_message and { type, tripId,
// tripInquiryId } on trip.* — hence every key but `type` is optional here.
export interface RidePushData {
  v?: '2';
  type: RidePushType;
  recipientRole?: PushRecipientRole;
  recipientUserId?: string;
  tripId?: string;
  tripInquiryId?: string;
  inquiryId?: string;
  // chat_message only.
  messageId?: string;
  // trip.driverArrived only.
  stopId?: string;
}

// Sent to a personal vehicle's owner when an admin decides on it
// (kerayego-backend src/modules/user-vehicles/user-vehicle-events.ts). No v or
// recipient keys.
export type UserVehiclePushType =
  | 'userVehicle.approved'
  | 'userVehicle.rejected'
  | 'userVehicle.suspended'
  | 'userVehicle.reactivated';

export interface UserVehiclePushData {
  type: UserVehiclePushType;
  userVehicleId: string;
}

// Sent to a rental customer about their booking (kerayego-backend
// src/modules/notifications/listeners/booking-push.listener.ts): a status the
// business (or KerayeGo, or the auto-complete) set, and the driver's Start /
// End. Data: { type, bookingId, recipientUserId, status? }.
export type BookingPushType = 'booking.statusChanged' | 'booking.jobStarted' | 'booking.jobCompleted';

// "Share your location" reminder to a rental customer when their sharing
// window opens (kerayego-backend src/modules/reminders/reminders.service.ts
// REMINDER_PUSH_TYPES, plan A44). Data: { type, bookingId, recipientUserId }.
// The carpool rider's one, trip.shareLocation, is a ride push (RidePushType).
export type BookingReminderPushType = 'booking.shareLocation';
