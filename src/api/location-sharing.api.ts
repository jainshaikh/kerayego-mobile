import apiClient from './client';
import type { DriverLocationFix } from './trips.api';
import type {
  ApiResponse,
  CustomerLocationAck,
  LocationShareTarget,
  LocationSharingPauseState,
  MyLocationSharing,
} from '../types/api.types';

// A customer's location shared with their driver until pickup — a carpool
// rider (TRIP_INQUIRY) or a rental customer (BOOKING). The backend decides
// when each window is open; see features/liveRide/backgroundLocation/
// customerLocationSharing.ts for the sender.

// Same fix shape as the driver's (the backend's LocationFixDto).
export type CustomerLocationFix = DriverLocationFix;

export type LocationShareTargetRef = Pick<LocationShareTarget, 'kind' | 'id'>;

function locationPath(target: LocationShareTargetRef): string {
  return target.kind === 'TRIP_INQUIRY'
    ? `/trip-inquiries/${target.id}/location`
    : `/booking-requests/${target.id}/customer-location`;
}

function pausePath(target: LocationShareTargetRef): string {
  return target.kind === 'TRIP_INQUIRY'
    ? `/trip-inquiries/${target.id}/location-sharing`
    : `/booking-requests/${target.id}/customer-location-sharing`;
}

export const locationSharingApi = {
  /** GET /users/me/location-sharing — every window open now, and when the next one opens. */
  getMine: async (): Promise<MyLocationSharing> => {
    const res = await apiClient.get<ApiResponse<MyLocationSharing>>('/users/me/location-sharing');
    return res.data.data;
  },

  /**
   * POST /trip-inquiries/:id/location or /booking-requests/:id/customer-location
   * (1–30 fixes). 404 not yours / gone; 409 LOCATION_SHARING_CLOSED (outside
   * the window) or LOCATION_SHARING_PAUSED.
   */
  postLocations: async (
    target: LocationShareTargetRef,
    locations: CustomerLocationFix[],
  ): Promise<CustomerLocationAck> => {
    const res = await apiClient.post<ApiResponse<CustomerLocationAck>>(locationPath(target), { locations });
    return res.data.data;
  },

  /** PATCH …/location-sharing or …/customer-location-sharing — Stop (paused: true) / Resume. */
  setPaused: async (target: LocationShareTargetRef, paused: boolean): Promise<LocationSharingPauseState> => {
    const res = await apiClient.patch<ApiResponse<LocationSharingPauseState>>(pausePath(target), { paused });
    return res.data.data;
  },
};
