import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { listingsApi, type ListingFilters } from '../../api/listings.api';

export function useInfiniteListings(filters: Omit<ListingFilters, 'page'>) {
  return useInfiniteQuery({
    queryKey: ['listings', 'infinite', filters],
    queryFn: ({ pageParam }) => listingsApi.getAll({ ...filters, page: pageParam, limit: filters.limit ?? 12 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.meta.hasNextPage ? lastPage.meta.page + 1 : undefined),
    // Every distinct `search`/filter value is a brand-new query key, so
    // without this the list would flash to a full loading skeleton on every
    // committed search change instead of quietly updating in place.
    placeholderData: keepPreviousData,
  });
}

export function useVehicleDetail(slug: string | undefined) {
  return useQuery({
    queryKey: ['vehicle', slug],
    queryFn: () => listingsApi.getBySlug(slug as string),
    enabled: !!slug,
  });
}

export function useMakes() {
  return useQuery({
    queryKey: ['listings', 'makes'],
    queryFn: () => listingsApi.getMakes(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCities() {
  return useQuery({
    queryKey: ['listings', 'cities'],
    queryFn: () => listingsApi.getCities(),
    staleTime: 10 * 60 * 1000,
  });
}
