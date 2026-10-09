import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  tripInquiriesApi,
  type CreateTripInquiryPayload,
  type UpdateTripInquiryStatusPayload,
} from '../../api/trip-inquiries.api';
import type { MyActiveRide } from '../../api/trips.api';
import { normalizeApiError } from '../../api/errors';
import type { TripInquiryStatus } from '../../types/enums';

// ── Rider hooks ─────────────────────────────────────────────────────────────

export function useMyTripInquiries(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['myTripInquiries', page, limit],
    queryFn: () => tripInquiriesApi.getMine(page, limit),
  });
}

export function useMyTripInquiryCounts() {
  return useQuery({
    queryKey: ['myTripInquiries', 'counts'],
    queryFn: () => tripInquiriesApi.getMyCounts(),
  });
}

export function useTripInquiry(id: string | undefined) {
  return useQuery({
    queryKey: ['tripInquiry', id],
    queryFn: () => tripInquiriesApi.getOne(id as string),
    enabled: !!id,
    // Poll while there's day-of status actually worth watching (an accepted
    // seat on a trip that's about to run or currently running) — stops once
    // the trip wraps up, the seat isn't confirmed, or this rider has been
    // dropped off, so a rider who's just browsing a pending/rejected request
    // (or whose ride is over) isn't polled forever. A no-show keeps polling
    // while the trip runs: the driver's Pickup can still undo it.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.status !== 'ACCEPTED' || data.droppedOffAt) return false;
      return data.trip.status === 'ACTIVE' || data.trip.status === 'IN_PROGRESS' ? 20_000 : false;
    },
  });
}

export function useCreateTripInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTripInquiryPayload) => tripInquiriesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTripInquiries'] });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['trip'] });
    },
  });
}

// Everything a request's status change can move — including the app-wide
// ride lock: a rider cancelling their seat mid-trip is no longer on a ride.
function invalidateAfterStatusChange(queryClient: QueryClient, id: string) {
  queryClient.invalidateQueries({ queryKey: ['tripInquiry', id] });
  queryClient.invalidateQueries({ queryKey: ['myTripInquiries'] });
  queryClient.invalidateQueries({ queryKey: ['tripInquiryInbox'] });
  queryClient.invalidateQueries({ queryKey: ['trips'] });
  queryClient.invalidateQueries({ queryKey: ['trip'] });
  queryClient.invalidateQueries({ queryKey: ['myTrip'] });
  queryClient.invalidateQueries({ queryKey: ['myActiveRide'] });
}

// Takes the target id per-call (not bound to the hook) so a single instance
// can drive both a single-item detail screen and a list of many inquiries.
export function useUpdateTripInquiryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTripInquiryStatusPayload }) =>
      tripInquiriesApi.updateStatus(id, data),
    onSuccess: (_result, { id }) => invalidateAfterStatusChange(queryClient, id),
    // A 409 means the request (or its trip) changed after this screen loaded
    // it — refetch, so the screen shows the real state next to the server's
    // message instead of offering the same stale action again.
    onError: (error, { id }) => {
      if (normalizeApiError(error).kind === 'conflict') invalidateAfterStatusChange(queryClient, id);
    },
  });
}

/**
 * Lets the app-wide ride lock (useActiveRideLock in app/_layout.tsx) go as
 * soon as this request's screen knows the ride is over for this rider —
 * dropped off, marked a no-show, seat cancelled, trip ended — instead of
 * waiting out its 20 s poll, during which leaving this screen would bounce
 * the rider straight back. Only refetches when the cached lock still points
 * at this request. `rideLocked` is null until the request has loaded.
 */
export function useReleaseRiderActiveRide(inquiryId: string | undefined, rideLocked: boolean | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (rideLocked !== false || !inquiryId) return;
    const cached = queryClient.getQueryData<MyActiveRide>(['myActiveRide']);
    if (cached?.role === 'rider' && cached.tripInquiryId === inquiryId) {
      queryClient.invalidateQueries({ queryKey: ['myActiveRide'] });
    }
  }, [inquiryId, rideLocked, queryClient]);
}

// ── Poster hooks (inbox across all of my own posted trips) ─────────────────

export function useTripInquiryInbox(params?: { tripId?: string; status?: TripInquiryStatus; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['tripInquiryInbox', params],
    queryFn: () => tripInquiriesApi.getInbox(params),
  });
}

export function useTripInquiryInboxCounts() {
  return useQuery({
    queryKey: ['tripInquiryInbox', 'counts'],
    queryFn: () => tripInquiriesApi.getInboxCounts(),
  });
}
