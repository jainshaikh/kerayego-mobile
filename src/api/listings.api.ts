import apiClient from './client';
import type { ApiResponse, PaginationMetaExtended, VehicleCard, VehicleDetail } from '../types/api.types';
import type { FuelType, Transmission } from '../types/enums';

export interface ListingFilters {
  search?: string;
  make?: string;
  fuelType?: FuelType;
  transmission?: Transmission;
  priceMin?: number;
  priceMax?: number;
  city?: string;
  seats?: number;
  yearMin?: number;
  yearMax?: number;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'popular';
  providerSlug?: string;
  page?: number;
  limit?: number;
  // Nearby search — independent of city, mutually exclusive with it in the UI.
  // radiusKm defaults to 25 server-side if lat/lng are set without it.
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export interface ListingsResult {
  data: VehicleCard[];
  meta: PaginationMetaExtended;
}

// NOTE: there is no separate /listings/search route — search is a query param on GET /listings.
export const listingsApi = {
  getAll: async (filters: ListingFilters = {}): Promise<ListingsResult> => {
    const params: Record<string, string | number> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && value !== null) {
        params[key] = value as string | number;
      }
    });

    const res = await apiClient.get<ApiResponse<VehicleCard[]>>('/listings', { params });
    return { data: res.data.data, meta: res.data.meta as unknown as PaginationMetaExtended };
  },

  getBySlug: async (slug: string): Promise<VehicleDetail> => {
    const res = await apiClient.get<ApiResponse<VehicleDetail>>(`/listings/${slug}`);
    return res.data.data;
  },

  getMakes: async (): Promise<string[]> => {
    const res = await apiClient.get<ApiResponse<string[]>>('/listings/meta/makes');
    return res.data.data;
  },

  getCities: async (): Promise<string[]> => {
    const res = await apiClient.get<ApiResponse<string[]>>('/listings/meta/cities');
    return res.data.data;
  },
};
