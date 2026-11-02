import apiClient from './client';
import type { ApiResponse, PaginationMeta, PhoneSendCodeResult, SavedVehicle, User } from '../types/api.types';

export const usersApi = {
  getMe: async () => {
    const res = await apiClient.get<ApiResponse<User>>('/users/me');
    return res.data.data;
  },

  // The mobile number is not changed here any more — only through
  // sendPhoneCode → verifyPhoneCode (the backend still accepts `phone` for
  // old app versions, and clears its verification when it changes).
  updateMe: async (data: { name?: string; whatsappUpdates?: boolean }) => {
    const res = await apiClient.patch<ApiResponse<User>>('/users/me', data);
    return res.data.data;
  },

  /**
   * POST /users/me/phone/send-code — sends a 6-digit code on WhatsApp to
   * `phone` (any format the backend accepts: 0300…, +92…). Errors: 400
   * invalid number, 409 PHONE_TAKEN, 429 CODE_RESEND_TOO_SOON /
   * CODE_LIMIT_REACHED, 502 WHATSAPP_SEND_FAILED, 503 WHATSAPP_UNAVAILABLE.
   */
  sendPhoneCode: async (phone: string) => {
    const res = await apiClient.post<ApiResponse<PhoneSendCodeResult>>('/users/me/phone/send-code', { phone });
    return res.data.data;
  },

  /**
   * POST /users/me/phone/verify — the code makes the number this account's
   * verified phone; answers with the updated user. 400 CODE_INVALID for a
   * wrong/expired code, 409 PHONE_TAKEN.
   */
  verifyPhoneCode: async (code: string) => {
    const res = await apiClient.post<ApiResponse<User>>('/users/me/phone/verify', { code });
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
