import apiClient from './client';
import type { ApiResponse, PaginationMeta } from '../types/api.types';

// Mirrors the backend's EntityType — a review's subject can be any of these.
export type ReviewSubjectType = 'VEHICLE' | 'USER_VEHICLE' | 'PROVIDER' | 'USER';
export type ReviewContext = 'BOOKING_REQUEST' | 'TRIP_INQUIRY';

export interface ReviewEntryInput {
  subjectType: ReviewSubjectType;
  subjectId: string;
  rating: number;
  comment?: string;
}

export interface CreateReviewPayload {
  context: ReviewContext;
  contextId: string;
  entries: ReviewEntryInput[];
}

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  author: { id: string; name: string };
}

export interface ReviewsResponse {
  data: PublicReview[];
  meta: PaginationMeta;
}

export interface RatingSummary {
  count: number;
  average: number | null;
  /** USER subjects only — count of accepted, already-departed trip requests on either side (rider or driver). */
  completedTripsCount?: number;
}

// GET /reviews/my/eligible (ReviewsService.getMyEligible). bookingsAsCustomer
// rows carry vehicle + providerProfileId + the assigned driver;
// bookingsAsProvider rows carry only user.
export interface EligibleBooking {
  id: string;
  updatedAt?: string;
  providerProfileId?: string;
  vehicle?: { id: string; title: string; slug: string };
  // The rental's driver (bookingsAsCustomer only) — null when the business
  // never assigned one, in which case only the car can be rated.
  assignedDriverId?: string | null;
  assignedDriver?: { id: string; name: string; driverProfile: { fullName: string } | null } | null;
  user?: { id: string; name: string };
}

// tripsAsRider rows carry the trip's vehicle ids + poster; tripsAsDriver rows
// carry user (the rider) and only id/originCity/destinationCity on trip.
export interface EligibleTrip {
  id: string;
  trip: {
    id: string;
    originCity: string;
    destinationCity: string;
    departureAt?: string;
    userVehicleId?: string | null;
    // A return trip runs in a business's fleet car (userVehicleId is null).
    fleetVehicleId?: string | null;
    isReturnTrip?: boolean;
    postedByUserId?: string;
  };
  user?: { id: string; name: string };
}

export interface EligibleForReview {
  bookingsAsCustomer: EligibleBooking[];
  bookingsAsProvider: EligibleBooking[];
  tripsAsRider: EligibleTrip[];
  tripsAsDriver: EligibleTrip[];
}

export const reviewsApi = {
  create: async (data: CreateReviewPayload) => {
    const res = await apiClient.post<ApiResponse<unknown>>('/reviews', data);
    return res.data.data;
  },

  getPublic: async (
    subjectType: ReviewSubjectType,
    subjectId: string,
    page = 1,
    limit = 20,
  ): Promise<ReviewsResponse> => {
    const res = await apiClient.get<ApiResponse<PublicReview[]>>('/reviews', {
      params: { subjectType, subjectId, page, limit },
    });
    return { data: res.data.data, meta: res.data.meta as unknown as PaginationMeta };
  },

  getSummary: async (subjectType: ReviewSubjectType, subjectId: string): Promise<RatingSummary> => {
    const res = await apiClient.get<ApiResponse<RatingSummary>>('/reviews/summary', {
      params: { subjectType, subjectId },
    });
    return res.data.data;
  },

  getMyEligible: async (): Promise<EligibleForReview> => {
    const res = await apiClient.get<ApiResponse<EligibleForReview>>('/reviews/my/eligible');
    return res.data.data;
  },
};
