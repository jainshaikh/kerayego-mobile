import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  tripsApi,
  type CreateTripPayload,
  type RecordTripEventPayload,
  type TripFilters,
  type UpdateTripPayload,
} from '../../api/trips.api';

export function useInfiniteTrips(filters: Omit<TripFilters, 'page'>) {
  return useInfiniteQuery({
    queryKey: ['trips', 'infinite', filters],
    queryFn: ({ pageParam }) => tripsApi.getAll({ ...filters, page: pageParam, limit: filters.limit ?? 12 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.meta.hasNextPage ? lastPage.meta.page + 1 : undefined),
  });
}

export function useTripCities() {
  return useQuery({
    queryKey: ['trips', 'cities'],
    queryFn: () => tripsApi.getMetaCities(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useTripRouteGroups() {
  return useQuery({
    queryKey: ['trips', 'routeGroups'],
    queryFn: () => tripsApi.getRouteGroups(),
    staleTime: 60 * 1000,
  });
}

export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: ['trip', id],
    queryFn: () => tripsApi.getOne(id as string),
    enabled: !!id,
  });
}

export function useMyTrips(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['myTrips', page, limit],
    queryFn: () => tripsApi.getMine(page, limit),
  });
}

export function useMyTrip(id: string | undefined) {
  return useQuery({
    queryKey: ['myTrip', id],
    queryFn: () => tripsApi.getMineOne(id as string),
    enabled: !!id,
  });
}

export function useCreateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTripPayload) => tripsApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myTrips'] }),
  });
}

export function useUpdateTrip(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateTripPayload) => tripsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrip', id] });
      queryClient.invalidateQueries({ queryKey: ['myTrips'] });
    },
  });
}

export function useCancelTrip(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => tripsApi.cancel(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrip', id] });
      queryClient.invalidateQueries({ queryKey: ['myTrips'] });
    },
  });
}

// ── Day-of trip execution ─────────────────────────────────────────────────

export function useStartTrip(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => tripsApi.startTrip(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrip', id] });
      queryClient.invalidateQueries({ queryKey: ['myTrips'] });
      queryClient.invalidateQueries({ queryKey: ['tripManifest', id] });
    },
  });
}

export function useTripManifest(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['tripManifest', id],
    queryFn: () => tripsApi.getManifest(id as string),
    enabled: !!id && enabled,
  });
}

// The backend returns the created TripEvent (not the manifest) — only PICKUP
// and DROPOFF actually change a rider's pickupConfirmedAt/droppedOffAt, so a
// refetch is what picks those up. NO_SHOW is logged but doesn't change either
// field; the screen tracks that locally since there's nothing server-side to
// re-sync for it.
export function useRecordTripEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RecordTripEventPayload) => tripsApi.recordEvent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tripManifest', id] });
    },
  });
}

export function useEndTrip(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => tripsApi.endTrip(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrip', id] });
      queryClient.invalidateQueries({ queryKey: ['myTrips'] });
      queryClient.invalidateQueries({ queryKey: ['tripManifest', id] });
    },
  });
}

// Polls for the current user's one live-ride "lock" (driver or rider on a
// trip that's currently running). `enabled` follows the same convention as
// useTripManifest above — pass false (e.g. while not authenticated) to skip
// the query and its polling entirely rather than reading auth state in here.
// 20s matches useTripInquiry's existing day-of-status polling cadence.
export function useMyActiveRide(enabled = true) {
  return useQuery({
    queryKey: ['myActiveRide'],
    queryFn: () => tripsApi.getMyActiveRide(),
    enabled,
    refetchInterval: enabled ? 20_000 : false,
  });
}
