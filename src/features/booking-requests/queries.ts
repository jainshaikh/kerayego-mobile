import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingRequestsApi, type CreateBookingRequestPayload, type UpdateBookingStatusPayload } from '../../api/booking-requests.api';

export function useMyBookingRequests(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['myInquiries', page, limit],
    queryFn: () => bookingRequestsApi.getMine(page, limit),
  });
}

export function useMyBookingCounts() {
  return useQuery({
    queryKey: ['myInquiries', 'counts'],
    queryFn: () => bookingRequestsApi.getMyCounts(),
  });
}

export function useBookingRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['booking', id],
    queryFn: () => bookingRequestsApi.getOne(id as string),
    enabled: !!id,
  });
}

export function useCreateBookingRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateBookingRequestPayload) => bookingRequestsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myInquiries'] });
    },
  });
}

export function useUpdateBookingStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateBookingStatusPayload) => bookingRequestsApi.updateStatus(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking', id] });
      queryClient.invalidateQueries({ queryKey: ['myInquiries'] });
    },
  });
}

// The rental customer's live view of their assigned driver while the booking
// is IN_PROGRESS — polled every 10 s while `enabled` (the screen is open and
// the app in the foreground; there's no socket for rentals).
export const BOOKING_LIVE_POLL_MS = 10_000;

export function useBookingLiveDriver(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['booking', id, 'liveDriver'],
    queryFn: () => bookingRequestsApi.getLiveDriver(id as string),
    enabled: !!id && enabled,
    staleTime: 0,
    refetchInterval: enabled ? BOOKING_LIVE_POLL_MS : false,
  });
}

// The driver's recent path (newest 200 fixes) — the breadcrumb on that map.
export function useBookingLiveRoute(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['booking', id, 'liveRoute'],
    queryFn: () => bookingRequestsApi.getLiveRoute(id as string),
    enabled: !!id && enabled,
    staleTime: 0,
    refetchInterval: enabled ? BOOKING_LIVE_POLL_MS : false,
  });
}
