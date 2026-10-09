import apiClient from './client';
import type { ApiResponse, PaginationMeta, TripVehicleImage } from '../types/api.types';
import type { Market, PickupSource, TripInquiryStatus, TripStatus } from '../types/enums';

export interface TripInquiryUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

// A trip stop as the rider's request references it. lat/lng are null for a
// stop the driver typed as free text instead of picking it on the map.
export interface TripInquiryStopRef {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
}

export interface TripInquiryPickupStop extends TripInquiryStopRef {
  // GET /trip-inquiries/:id only: the SERVER time the driver first marked
  // arriving at this stop, null until then. Absent from the list endpoints
  // and from an older backend.
  arrivedAt?: string | null;
}

// One stop of the whole trip route (GET /trip-inquiries/:id only), already in
// route order — pickups then drop-offs, each by sortOrder.
export interface TripInquiryRouteStop {
  id: string;
  type: 'PICKUP' | 'DROPOFF';
  label: string;
  lat: number | null;
  lng: number | null;
  sortOrder: number;
  arrivedAt?: string | null;
}

export interface TripInquiryVehicle {
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  plateNumber: string;
  // The vehicle's market, which the trip's currency follows.
  country: Market;
  // The cover photo only (at most one).
  images: TripVehicleImage[];
}

export interface TripInquiryTrip {
  id: string;
  status: TripStatus;
  originCity: string;
  destinationCity: string;
  // Mirror the trip's FIRST pickup stop / LAST drop-off stop — the rider's
  // own point only for a legacy request made before stops existed.
  pickupPoint: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffPoint: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  departureAt: string;
  availableSeats: number;
  pricePerSeat: string | number;
  // The listing's public (WhatsApp) number — always present.
  contactNumber: string;
  postedByUserId: string;
  // The driver's personal email/phone reach the rider only once their seat
  // is ACCEPTED; null before that and after a rejection/expiry/cancellation.
  postedBy: { id: string; name: string; email: string | null; phone: string | null };
  userVehicle: TripInquiryVehicle;
  // GET /trip-inquiries/:id only, from a newer backend (absent otherwise) —
  // the rider's live view can't get them from the public GET /trips/:id,
  // which 404s once the trip has started.
  durationMinutes?: number | null;
  distanceKm?: number | null;
  stops?: TripInquiryRouteStop[];
}

export interface TripInquiry {
  id: string;
  // GET /trip-inquiries/:id only (newer backend).
  userId?: string;
  requestedSeats: number;
  pickupNote: string | null;
  message: string | null;
  status: TripInquiryStatus;
  // The driver's note on REJECTED; the system's reason on a driver-cancelled
  // trip (CANCELLED) or an auto-expiry (EXPIRED).
  rejectionReason: string | null;
  // The rider's own day-of status — set by the driver's manifest actions on
  // the trip this inquiry belongs to. Null until the driver taps Pickup/Dropoff
  // for this rider (or auto-resolved at trip end — see pickupSource).
  pickupConfirmedAt: string | null;
  pickupSource: PickupSource | null;
  droppedOffAt: string | null;
  // Set when the driver marked this rider as a no-show; their later Pickup
  // tap clears it. Absent (not just null) from an older backend.
  noShowAt?: string | null;
  // Structured stop this inquiry was made against — the source of truth for
  // rider geofence checks (see trip-request/[id].tsx). Null only for legacy
  // inquiries created before stops were required.
  pickupStop: TripInquiryPickupStop | null;
  dropoffStop: TripInquiryStopRef | null;
  createdAt: string;
  updatedAt: string;
  user: TripInquiryUser;
  trip: TripInquiryTrip;
  // GET /trip-inquiries/:id only (newer backend): the server's clock when it
  // built the response, so "driver arrived N min ago" never depends on the
  // phone's clock.
  serverNow?: string;
}

export interface CreateTripInquiryPayload {
  tripId: string;
  requestedSeats: number;
  pickupStopId: string;
  dropoffStopId: string;
  pickupNote?: string;
  message?: string;
}

export interface UpdateTripInquiryStatusPayload {
  newStatus: TripInquiryStatus;
  note?: string;
}

// Mirrors the backend's ChatMessage prisma model exactly (prisma/schema.prisma) —
// this same shape is both what GET /trip-inquiries/:id/messages returns (below)
// and what the live-ride socket's chat events carry (see features/liveRide/socket.ts).
export interface ChatMessage {
  id: string;
  tripInquiryId: string;
  senderId: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface ChatMessagesResult {
  data: ChatMessage[];
  meta: { limit: number; nextCursor: string | null };
}

export const tripInquiriesApi = {
  create: async (data: CreateTripInquiryPayload) => {
    const res = await apiClient.post<ApiResponse<TripInquiry>>('/trip-inquiries', data);
    return res.data.data;
  },

  getMine: async (page = 1, limit = 20) => {
    const res = await apiClient.get<ApiResponse<TripInquiry[]>>('/trip-inquiries', { params: { page, limit } });
    return { data: res.data.data, meta: res.data.meta as unknown as PaginationMeta };
  },

  getMyCounts: async (): Promise<{ pending: number }> => {
    const res = await apiClient.get<ApiResponse<{ pending: number }>>('/trip-inquiries/counts');
    return res.data.data;
  },

  getOne: async (id: string) => {
    const res = await apiClient.get<ApiResponse<TripInquiry>>(`/trip-inquiries/${id}`);
    return res.data.data;
  },

  updateStatus: async (id: string, data: UpdateTripInquiryStatusPayload) => {
    const res = await apiClient.patch<ApiResponse<TripInquiry>>(`/trip-inquiries/${id}/status`, data);
    return res.data.data;
  },

  // Poster inbox — incoming requests across all of my own posted trips
  getInbox: async (params?: { tripId?: string; status?: TripInquiryStatus; page?: number; limit?: number }) => {
    const res = await apiClient.get<ApiResponse<TripInquiry[]>>('/my/trip-inquiries', { params });
    return { data: res.data.data, meta: res.data.meta as unknown as PaginationMeta };
  },

  getInboxCounts: async (): Promise<{ pending: number }> => {
    const res = await apiClient.get<ApiResponse<{ pending: number }>>('/my/trip-inquiries/counts');
    return res.data.data;
  },

  // Chat history catch-up (reconnect / initial sheet open) — the socket's
  // rooms only ever deliver messages sent while a socket is connected and
  // joined, so this is the reliable source for everything sent before that.
  // `after` (an ISO-8601 createdAt cursor) fetches only messages strictly
  // newer than it — see RideRealtimeGateway/TripInquiriesService.getMessages.
  // One call is one page, OLDEST first (50 at most; meta.nextCursor is set
  // while pages come back full) — features/liveRide/chatHistory.ts follows
  // the cursor to a thread's newest message.
  getMessages: async (tripInquiryId: string, after?: string): Promise<ChatMessagesResult> => {
    const res = await apiClient.get<ApiResponse<ChatMessage[]>>(`/trip-inquiries/${tripInquiryId}/messages`, {
      params: after ? { after } : undefined,
    });
    return { data: res.data.data, meta: res.data.meta as unknown as ChatMessagesResult['meta'] };
  },
};
