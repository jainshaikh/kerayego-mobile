import type {
  BookingRequestStatus,
  FuelType,
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
// Message-only endpoints (register/logout/verify-email/forgot-password/reset-password) do NOT
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
    details?: { field?: string; message: string }[];
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
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
}

export interface LoginResult {
  accessToken: string;
  user: AuthUser;
  // Only present for mobile clients (x-client-type: mobile header) — web relies on the
  // httpOnly cookie instead. See kerayego-backend auth.controller.ts.
  refreshToken?: string;
}

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

// Public listing card (GET /listings, /listings/featured)
export interface VehicleCard {
  id: string;
  slug: string;
  title: string;
  make: string;
  model: string;
  year: number;
  pricePerDay: string;
  pricePerWeek: string | null;
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
  pricePerWeek: string | null;
  pricePerMonth: string | null;
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

export interface BookingRequest {
  id: string;
  status: BookingRequestStatus;
  requestedFromDate: string;
  requestedToDate: string; // server-derived from durationType/durationQuantity
  durationType: RentalDurationType;
  durationQuantity: number;
  totalPrice: string; // server-derived: unit price for durationType * durationQuantity
  pickupLocation: string | null;
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
}

// ─── User Vehicles (personal vehicle, used to post Trips) ───────────────────

export interface UserVehicleDocument {
  id: string;
  documentType:
    | 'ID_DOCUMENT'
    | 'ID_DOCUMENT_FRONT'
    | 'ID_DOCUMENT_BACK'
    | 'DRIVING_LICENSE'
    | 'VEHICLE_REGISTRATION';
  fileUrl: string;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
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
  status: UserVehicleStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  // sortOrder 0 is the poster/cover shown as the card thumbnail
  images: UserVehicleImage[];
}

export interface UserVehicleDetail extends UserVehicle {
  documents: UserVehicleDocument[];
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
  userVehicle: {
    id: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    images: TripVehicleImage[];
  };
}

export interface TripDetail extends Omit<TripCard, 'userVehicle'> {
  rejectionReason: string | null;
  cancelReason: string | null;
  updatedAt: string;
  userVehicle: {
    id: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    plateNumber: string;
    status: UserVehicleStatus;
    images: UserVehicleImage[];
  };
}
