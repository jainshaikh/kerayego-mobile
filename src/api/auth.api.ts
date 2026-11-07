import apiClient from './client';
import type {
  ApiResponse,
  AuthUser,
  LoginCodeRequestResult,
  LoginResult,
  PhoneSignInRequestResult,
  PhoneSignInSession,
  PhoneVerifyResult,
} from '../types/api.types';
import { Role } from '../types/enums';

// Sign-in and sign-up are phone-first (2026-11-06): a WhatsApp code to the
// number (POST /auth/phone/request → /auth/phone/verify), then — for a number
// with no account — the profile step (POST /auth/phone/register). The emailed
// code (POST /auth/code/request + /auth/code/verify, plan A11, A21) stays as
// the "Sign in with email instead" backup, for sign-in only. The backend's
// password endpoints and POST /auth/register are kept for old app versions
// only — this app never calls them.

export interface VerifyCodePayload {
  email: string;
  code: string;
}

export interface PhoneVerifyPayload {
  // As sent to /auth/phone/request (or the E.164 number it answered with).
  phone: string;
  code: string;
}

export interface PhoneRegisterPayload {
  signupToken: string;
  name: string;
  email: string;
}

export const authApi = {
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

  /**
   * A WhatsApp code to the number — the same 200 whether or not it has an
   * account. 429 CODE_RESEND_TOO_SOON (retryAfterSeconds) / CODE_LIMIT_REACHED,
   * 502 WHATSAPP_SEND_FAILED, 503 WHATSAPP_UNAVAILABLE, 400 invalid number.
   */
  requestPhoneCode: async (phone: string) => {
    const res = await apiClient.post<ApiResponse<PhoneSignInRequestResult>>('/auth/phone/request', { phone });
    return res.data.data;
  },

  /**
   * needsSignup: false → the code-verify session; needsSignup: true → a
   * signupToken for the profile step. 401 CODE_INVALID, 403 suspended.
   */
  verifyPhoneCode: async (data: PhoneVerifyPayload) => {
    const res = await apiClient.post<ApiResponse<PhoneVerifyResult>>('/auth/phone/verify', data);
    return res.data.data;
  },

  /**
   * Creates the account (this app: role USER only) and signs it in. 401
   * SIGNUP_TOKEN_INVALID, 403 IDENTITY_BLOCKED, 409 EMAIL_TAKEN / PHONE_TAKEN.
   */
  registerWithPhone: async (data: PhoneRegisterPayload) => {
    const res = await apiClient.post<ApiResponse<PhoneSignInSession>>('/auth/phone/register', {
      ...data,
      role: Role.USER,
    });
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
