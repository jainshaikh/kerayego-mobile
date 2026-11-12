import apiClient from './client';
import type {
  ApiResponse,
  BookingEstimate,
  BookingLiveDriver,
  BookingLiveRouteFix,
  BookingRequest,
  PaginationMeta,
} from '../types/api.types';
import type { BookingRequestStatus, BookingTripType, RentalDurationType } from '../types/enums';

// One pickup or drop-off as the app sends it (plan §3c, A75): found by search
// or placed on the map, so the coordinates are always there. `city` fills the
// request's pickupCity / dropoffCity (the return-trip rule, A48 — send it for
// the first pickup and the last drop-off). The server orders them: every
// pickup in the order sent, then every drop-off.
export interface BookingStopPayload {
  type: 'PICKUP' | 'DROPOFF';
  label: string;
  lat: number;
  lng: number;
  city?: string;
  note?: string;
}

/**
 * POST /booking-requests — the new request shape (2026-11-11, plan §3c). This
 * app never sends the old free-text place fields (`pickupLocation`, `isOneWay`,
 * `dropoff*` with `stops` → 400 OLD_REQUEST_SHAPE).
 * - 6 / 12 hours / days: `tripType` required; the server works out the route
 *   and refuses one that doesn't fit (400 ROUTE_DOES_NOT_FIT).
 * - Week / month ("price to agree", A79, A85): no `tripType`;
 *   `driverHoursPerDay` and `daysPerWeek` required, `kmPerMonth` optional.
 * `durationQuantity`: omit for 6/12 hours; days 1–6, weeks 1–4, months 1–12.
 */
export interface CreateBookingRequestPayload {
  vehicleId: string;
  requestedFromDate: string; // ISO, in the future (400 START_TIME_PAST)
  durationType: RentalDurationType;
  durationQuantity?: number;
  tripType?: BookingTripType;
  stops: BookingStopPayload[];
  passengerCount: number;
  driverHoursPerDay?: number;
  daysPerWeek?: number;
  kmPerMonth?: number;
  message?: string;
}

/** POST /booking-requests/estimate (signed in, 20/min) — priced packages only. */
export interface EstimateBookingPayload {
  vehicleId: string;
  requestedFromDate: string;
  tripType: BookingTripType;
  stops: BookingStopPayload[];
  // The package picked — the response then says how it fits (`selected`).
  durationType?: RentalDurationType;
  durationQuantity?: number;
}

export interface UpdateBookingStatusPayload {
  newStatus: BookingRequestStatus;
  note?: string;
}

export interface BookingCounts {
  active: number;
  completed: number;
}

export const bookingRequestsApi = {
  create: async (data: CreateBookingRequestPayload) => {
    const res = await apiClient.post<ApiResponse<BookingRequest>>('/booking-requests', data);
    return res.data.data;
  },

  // The route through the stops and how it fits each of the car's priced
  // packages (A77). Nothing is stored; the request is checked again on send.
  // Week/month → 400 (they aren't routed).
  estimate: async (data: EstimateBookingPayload) => {
    const res = await apiClient.post<ApiResponse<BookingEstimate>>('/booking-requests/estimate', data);
    return res.data.data;
  },

  getMine: async (page = 1, limit = 20) => {
    const res = await apiClient.get<ApiResponse<BookingRequest[]>>('/booking-requests', { params: { page, limit } });
    return { data: res.data.data, meta: res.data.meta as unknown as PaginationMeta };
  },

  getMyCounts: async (): Promise<BookingCounts> => {
    const res = await apiClient.get<ApiResponse<BookingCounts>>('/booking-requests/counts');
    return res.data.data;
  },

  getOne: async (id: string) => {
    const res = await apiClient.get<ApiResponse<BookingRequest>>(`/booking-requests/${id}`);
    return res.data.data;
  },

  updateStatus: async (id: string, data: UpdateBookingStatusPayload) => {
    const res = await apiClient.patch<ApiResponse<BookingRequest>>(`/booking-requests/${id}/status`, data);
    return res.data.data;
  },

  // The customer's view of their assigned driver while the rental is
  // IN_PROGRESS (lastLocation null otherwise).
  getLiveDriver: async (id: string) => {
    const res = await apiClient.get<ApiResponse<BookingLiveDriver>>(`/booking-requests/${id}/live-driver`);
    return res.data.data;
  },

  // The driver's newest 200 fixes, oldest first — the breadcrumb on that map.
  getLiveRoute: async (id: string) => {
    const res = await apiClient.get<ApiResponse<BookingLiveRouteFix[]>>(`/booking-requests/${id}/live-route`);
    return res.data.data;
  },
};
