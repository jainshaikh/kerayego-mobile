import apiClient from './client';
import type {
  ApiResponse,
  AuthUser,
  LoginCodeRequestResult,
  LoginResult,
  RegisterResult,
} from '../types/api.types';

// Sign-in is by emailed 6-digit code only (plan A11, A21). The backend's
// password endpoints (/auth/login, forgot/reset/change-password) are kept for
// old app versions only — this app never calls them.

export interface RegisterPayload {
  name: string;
  email: string;
  phone: string;
}

export interface VerifyCodePayload {
  email: string;
  code: string;
}

export const authApi = {
  /** No password: the backend emails a sign-in code and answers codeSent: true. */
  register: async (data: RegisterPayload) => {
    const res = await apiClient.post<ApiResponse<RegisterResult>>('/auth/register', data);
    return res.data.data;
  },

  /** Always the same 200 answer, whether or not the email has an account. */
  requestCode: async (email: string) => {
    const res = await apiClient.post<ApiResponse<LoginCodeRequestResult>>('/auth/code/request', { email });
    return res.data.data;
  },

  /** The /auth/login session (refresh token in the body for X-Client-Type: mobile); 401 CODE_INVALID. */
  verifyCode: async (data: VerifyCodePayload) => {
    const res = await apiClient.post<ApiResponse<LoginResult>>('/auth/code/verify', data);
    return res.data.data;
  },

  logout: async () => {
    const res = await apiClient.post<ApiResponse<{ message: string }>>('/auth/logout');
    return res.data.data;
  },

  verifyEmail: async (token: string) => {
    const res = await apiClient.post<ApiResponse<{ message: string }>>('/auth/verify-email', { token });
    return res.data.data;
  },

  resendVerification: async () => {
    const res = await apiClient.post<ApiResponse<{ message: string }>>('/auth/resend-verification');
    return res.data.data;
  },
};

export type { AuthUser };
