import apiClient from './client';
import type { ApiResponse, PaginationMeta, SavedVehicle, User } from '../types/api.types';

export const usersApi = {
  getMe: async () => {
    const res = await apiClient.get<ApiResponse<User>>('/users/me');
    return res.data.data;
  },

  updateMe: async (data: { name?: string; phone?: string }) => {
    const res = await apiClient.patch<ApiResponse<User>>('/users/me', data);
    return res.data.data;
  },

  getSavedVehicles: async (page = 1, limit = 20) => {
    const res = await apiClient.get<ApiResponse<SavedVehicle[]>>('/users/me/saved-vehicles', {
      params: { page, limit },
    });
    return { data: res.data.data, meta: res.data.meta as unknown as PaginationMeta };
  },

  saveVehicle: async (vehicleId: string) => {
    const res = await apiClient.post<ApiResponse<{ id: string; vehicleId: string; createdAt: string }>>(
      '/users/me/saved-vehicles',
      { vehicleId },
    );
    return res.data.data;
  },

  removeSavedVehicle: async (vehicleId: string) => {
    await apiClient.delete(`/users/me/saved-vehicles/${vehicleId}`);
  },

  /**
   * POST /users/me/delete-request — schedules deletion 72 hours out and signs
   * the person out everywhere (all refresh tokens revoked). 400 = something is
   * still active; its message says what.
   */
  requestAccountDeletion: async (payload: { reason?: string }) => {
    const res = await apiClient.post<ApiResponse<AccountDeletionRequestResult>>(
      '/users/me/delete-request',
      payload,
    );
    return res.data.data;
  },
};

export interface AccountDeletionRequestResult {
  message: string;
  scheduledFor: string;
  status: 'PENDING_DELETION';
}
