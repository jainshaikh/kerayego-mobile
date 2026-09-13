import apiClient from './client';
import type { ApiResponse, PaginationMeta, PaginationMetaExtended, TripDetail } from '../types/api.types';
import type { PickupSource, TripEventType } from '../types/enums';

export interface TripFilters {
  originCity?: string;
  destinationCity?: string;
  date?: string; // YYYY-MM-DD
  minSeats?: number;
  sort?: 'departure_asc' | 'price_asc' | 'price_desc' | 'newest';
  page?: number;
  limit?: number;
}

export interface CreateTripPayload {
  userVehicleId: string;
  originCity: string;
  destinationCity: string;
  pickupPoint: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffPoint?: string;
  dropoffLat?: number;
  dropoffLng?: number;
  departureAt: string; // ISO date-time, must be in the future
  availableSeats: number;
  pricePerSeat: number;
  contactNumber: string;
  notes?: string;
}

export type UpdateTripPayload = Partial<CreateTripPayload>;

export interface TripRouteGroup {
  originCity: string;
  destinationCity: string;
  tripCount: number;
  minPricePerSeat: string | number | null;
  nextDepartureAt: string | null;
}

// Each rider now carries its resolved pickup/dropoff TripStop (structured, not
// the free-text pickupNote), so the manifest can be grouped/ordered by stop —
// see routeStops below, which lists every stop in visit order.
export interface ManifestStopRef {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface ManifestRider {
  id: string; // tripInquiryId
  requestedSeats: number;
  pickupNote: string | null;
  pickupConfirmedAt: string | null;
  pickupSource: PickupSource | null;
  droppedOffAt: string | null;
  pickupStop: ManifestStopRef | null;
  dropoffStop: ManifestStopRef | null;
  user: { id: string; name: string; phone: string | null };
}

// All PICKUP stops precede all DROPOFF stops, in the order the driver should visit them.
export interface ManifestRouteStop {
  id: string;
  type: 'PICKUP' | 'DROPOFF';
  label: string;
  lat: number;
  lng: number;
}

export interface TripManifest {
  trip: TripDetail;
  riders: ManifestRider[];
  routeStops: ManifestRouteStop[];
}

// `id` must be a client-generated UUID kept stable across retries of the same
// tap — the backend upserts by this id, so resending it after a dropped
// connection is always safe and never creates a duplicate event.
export interface RecordTripEventPayload {
  id: string;
  tripInquiryId?: string;
  type: TripEventType;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

export interface TripEvent {
  id: string;
  tripId: string;
  tripInquiryId: string | null;
  type: TripEventType;
  actorId: string;
  payload: Record<string, unknown> | null;
  occurredAt: string;
  syncedAt: string;
}

// The current user's one live-ride "lock", if any — null means neither
// driving nor riding an active trip right now. Drives the app-wide redirect
// in _layout.tsx that forces a reopen back onto the locked ride screen.
export type MyActiveRide =
  | { role: 'driver'; tripId: string }
  | { role: 'rider'; tripId: string; tripInquiryId: string }
  | null;

// NOTE: despite the Swagger summary text saying trips are "held for admin review",
// the actual service creates them with status ACTIVE immediately (Prisma default) —
// UserVehicle verification is what's gated, not the trip itself.
export const tripsApi = {
  getAll: async (filters: TripFilters = {}) => {
    const params: Record<string, string | number> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params[key] = value as string | number;
    });
    const res = await apiClient.get<ApiResponse<TripDetail[]>>('/trips', { params });
    return { data: res.data.data, meta: res.data.meta as unknown as PaginationMetaExtended };
  },

  getMetaCities: async () => {
    const res = await apiClient.get<ApiResponse<{ origins: string[]; destinations: string[] }>>('/trips/meta/cities');
    return res.data.data;
  },

  // Pre-aggregated by the backend (Prisma groupBy on originCity/destinationCity,
  // sorted by tripCount desc) — do not derive this by grouping a paginated /trips
  // page client-side, it would only reflect a partial slice.
  getRouteGroups: async () => {
    const res = await apiClient.get<ApiResponse<TripRouteGroup[]>>('/trips/meta/routes');
    return res.data.data;
  },

  getOne: async (id: string) => {
    const res = await apiClient.get<ApiResponse<TripDetail>>(`/trips/${id}`);
    return res.data.data;
  },

  create: async (data: CreateTripPayload) => {
    const res = await apiClient.post<ApiResponse<TripDetail>>('/trips', data);
    return res.data.data;
  },

  getMine: async (page = 1, limit = 20) => {
    const res = await apiClient.get<ApiResponse<TripDetail[]>>('/my/trips', { params: { page, limit } });
    return { data: res.data.data, meta: res.data.meta as unknown as PaginationMeta };
  },

  getMineOne: async (id: string) => {
    const res = await apiClient.get<ApiResponse<TripDetail>>(`/my/trips/${id}`);
    return res.data.data;
  },

  update: async (id: string, data: UpdateTripPayload) => {
    const res = await apiClient.patch<ApiResponse<TripDetail>>(`/my/trips/${id}`, data);
    return res.data.data;
  },

  cancel: async (id: string, reason?: string) => {
    const res = await apiClient.patch<ApiResponse<TripDetail>>(`/my/trips/${id}/cancel`, { reason });
    return res.data.data;
  },

  // ── Day-of trip execution ─────────────────────────────────────────────────

  startTrip: async (id: string) => {
    const res = await apiClient.post<ApiResponse<TripDetail>>(`/my/trips/${id}/start`);
    return res.data.data;
  },

  getManifest: async (id: string) => {
    const res = await apiClient.get<ApiResponse<TripManifest>>(`/my/trips/${id}/manifest`);
    return res.data.data;
  },

  // Note: this returns the created TripEvent itself, not the manifest — an
  // event with type NO_SHOW does NOT change pickupConfirmedAt/droppedOffAt on
  // the rider (only PICKUP and DROPOFF do), so the manifest cache is not
  // refetched/updated automatically here. Callers should track NO_SHOW taps
  // locally if they want to reflect it in the UI before the next fetch.
  recordEvent: async (id: string, data: RecordTripEventPayload) => {
    const res = await apiClient.post<ApiResponse<TripEvent>>(`/my/trips/${id}/events`, data);
    return res.data.data;
  },

  endTrip: async (id: string) => {
    const res = await apiClient.post<ApiResponse<TripDetail>>(`/my/trips/${id}/end`);
    return res.data.data;
  },

  getMyActiveRide: async (): Promise<MyActiveRide> => {
    const res = await apiClient.get<ApiResponse<MyActiveRide>>('/my/active-ride');
    return res.data.data;
  },
};
