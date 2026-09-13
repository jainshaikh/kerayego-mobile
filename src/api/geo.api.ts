import apiClient from './client';
import type { ApiResponse } from '../types/api.types';

export interface ReverseGeocodeResult {
  label: string;
  city: string | null;
  formattedAddress: string;
}

export interface PlaceSuggestion {
  placeId: string;
  text: string;
}

export interface PlaceDetails {
  formattedAddress: string;
  lat: number;
  lng: number;
}

export interface RouteDirectionStep {
  instruction: string;
  distanceMeters: number;
}

export interface RouteDirections {
  polyline: { lat: number; lng: number }[];
  distanceKm: number;
  durationMinutes: number;
  steps: RouteDirectionStep[];
}

// All three proxy through the backend's server-side Google Maps key — mobile
// has no Places-scoped key of its own (see .env's comment on
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, which is Maps SDK only), so this avoids
// needing one.
export const geoApi = {
  reverseGeocode: async (lat: number, lng: number): Promise<ReverseGeocodeResult> => {
    const res = await apiClient.get<ApiResponse<ReverseGeocodeResult>>('/geo/reverse', { params: { lat, lng } });
    return res.data.data;
  },

  autocompletePlaces: async (
    input: string,
    regionCodes?: string[],
    sessionToken?: string,
  ): Promise<PlaceSuggestion[]> => {
    const res = await apiClient.get<ApiResponse<{ suggestions: PlaceSuggestion[] }>>('/geo/places/autocomplete', {
      params: { input, regionCodes: regionCodes?.join(','), sessionToken },
    });
    return res.data.data.suggestions;
  },

  getPlaceDetails: async (placeId: string, sessionToken?: string): Promise<PlaceDetails> => {
    const res = await apiClient.get<ApiResponse<PlaceDetails>>('/geo/places/details', {
      params: { placeId, sessionToken },
    });
    return res.data.data;
  },

  // Route polyline + turn-by-turn steps for the live-ride map. Callers are
  // expected to treat a thrown error (including the backend's 404 when no
  // route is found) as "no overlay to show" and fail gracefully — this is a
  // nice-to-have map overlay, never something that should block the core
  // pickup/dropoff flow.
  getRouteDirections: async (
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ): Promise<RouteDirections> => {
    const res = await apiClient.get<ApiResponse<RouteDirections>>('/geo/route-directions', {
      params: {
        originLat: origin.lat,
        originLng: origin.lng,
        destLat: destination.lat,
        destLng: destination.lng,
      },
    });
    return res.data.data;
  },
};
