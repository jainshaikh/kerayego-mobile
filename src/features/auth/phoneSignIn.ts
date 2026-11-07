import type { NormalizedApiError } from '../../api/errors';
import { DEFAULT_MARKET, MARKETS } from '../../constants/markets';
import {
  PhoneAuthErrorCode,
  PhoneErrorCode,
  type PhoneSignInRequestResult,
  type PhoneSignupRequired,
} from '../../types/api.types';
import { Market } from '../../types/enums';
import { PHONE_ERROR_MESSAGES, phoneVerificationErrorMessage } from '../phone-verification/phoneVerification';
import { resendAvailableAt, resendDelaySeconds } from './signInCode';

// Pure helpers for phone-first sign-in / sign-up (2026-11-06):
// 1. number → POST /auth/phone/request;
// 2. WhatsApp code → POST /auth/phone/verify — signs in (needsSignup: false),
//    or hands back a signupToken (needsSignup: true);
// 3. profile (name, email; role USER) → POST /auth/phone/register.
// Used by PhoneSignInFlow (login and register screens); unit-tested in
// phoneSignIn.test.ts. The send-code error handling is in-app phone
// verification's (features/phone-verification/phoneVerification.ts).

export const PHONE_SIGN_IN_MESSAGES = {
  CODE_SENT: 'We sent a 6-digit code to your WhatsApp.',
  SIGNUP_EXPIRED: "That took too long. Enter your number again and we'll send a new code.",
  PHONE_TAKEN_ON_SIGNUP:
    'An account with this number was just created. Enter your number again to sign in to it.',
  EMAIL_TAKEN: 'An account with this email already exists. Sign in with email instead.',
} as const;

// ─── The number ─────────────────────────────────────────────────────────────

/** The country choices on the number step, Pakistan first (the default). */
export const PHONE_COUNTRIES: readonly Market[] = [Market.PK, Market.SA, Market.AE];

export const DEFAULT_PHONE_COUNTRY: Market = DEFAULT_MARKET;

/** A local mobile number as people write it in each country. */
const LOCAL_PLACEHOLDERS: Record<Market, string> = {
  [Market.PK]: '0300 1234567',
  [Market.SA]: '050 123 4567',
  [Market.AE]: '050 123 4567',
};

export function phonePlaceholder(country: Market): string {
  return LOCAL_PLACEHOLDERS[country] ?? LOCAL_PLACEHOLDERS[DEFAULT_PHONE_COUNTRY];
}

/** The country chip's label, e.g. "Pakistan +92". */
export function phoneCountryLabel(country: Market): string {
  const meta = MARKETS[country] ?? MARKETS[DEFAULT_PHONE_COUNTRY];
  return `${meta.label} ${meta.phoneCallingCode}`;
}

/**
 * What POST /auth/phone/request gets for what was typed with `country`
 * chosen. The backend normalises and checks the result (400 when invalid):
 * - already international ("+966…", "00971…") → as typed;
 * - otherwise the digits, without the local leading 0, after the country's
 *   calling code: Pakistan "0300 1234567" → "+923001234567", Saudi Arabia
 *   "050 123 4567" → "+966501234567";
 * - digits that already start with the calling code and are long enough to
 *   hold a national number after it ("923001234567") just get the "+".
 */
export function composePhoneNumber(typed: string, country: Market): string {
  const trimmed = typed.trim();
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) return trimmed;
  const callingDigits = (MARKETS[country] ?? MARKETS[DEFAULT_PHONE_COUNTRY]).phoneCallingCode.replace(/\D/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith(callingDigits) && digits.length - callingDigits.length >= 9) return `+${digits}`;
  return `+${callingDigits}${digits.replace(/^0+/, '')}`;
}

// ─── Flow state ─────────────────────────────────────────────────────────────

export interface SentPhoneCode {
  // E.164, as the server normalised it — what the code step and "Send again" use.
  phone: string;
  expiresInMinutes: number;
  // When "Send again" first works (ms).
  resendAt: number;
}

export interface PendingSignup {
  phone: string;
  signupToken: string;
  // When the signupToken stops working (ms).
  expiresAt: number;
}

export type PhoneAuthStep = 'phone' | 'code' | 'profile';

export interface PhoneAuthState {
  step: PhoneAuthStep;
  // The last code sent — kept after "Change" so the number step can go back to it.
  sent: SentPhoneCode | null;
  signup: PendingSignup | null;
  // A message for the number step after being sent back to it.
  notice: string | null;
}

export type PhoneAuthAction =
  // POST /auth/phone/request answered (first send or "Send again").
  | { type: 'codeSent'; result: PhoneSignInRequestResult; now: number }
  // 429 CODE_RESEND_TOO_SOON on "Send again": move the countdown.
  | { type: 'resendDelayed'; retryAt: number }
  // "Change" on the code step.
  | { type: 'changeNumber' }
  // "Enter the code sent to …" on the number step.
  | { type: 'backToCode' }
  // POST /auth/phone/verify → needsSignup: true.
  | { type: 'signupRequired'; result: PhoneSignupRequired; now: number }
  // Back to the number step, forgetting the code and token — with a message
  // for SIGNUP_TOKEN_INVALID, PHONE_TAKEN or an expired token; without one
  // for "Use a different number" on the profile step.
  | { type: 'restart'; notice?: string };

export const INITIAL_PHONE_AUTH_STATE: PhoneAuthState = { step: 'phone', sent: null, signup: null, notice: null };

export function phoneAuthReducer(state: PhoneAuthState, action: PhoneAuthAction): PhoneAuthState {
  switch (action.type) {
    case 'codeSent':
      return {
        step: 'code',
        sent: {
          phone: action.result.phone,
          expiresInMinutes: action.result.expiresInMinutes,
          resendAt: resendAvailableAt(action.now, resendDelaySeconds(action.result.resendInSeconds)),
        },
        signup: null,
        notice: null,
      };
    case 'resendDelayed':
      return state.sent ? { ...state, sent: { ...state.sent, resendAt: action.retryAt } } : state;
    case 'changeNumber':
      return state.step === 'code' ? { ...state, step: 'phone', notice: null } : state;
    case 'backToCode':
      return state.sent && state.step === 'phone' ? { ...state, step: 'code', notice: null } : state;
    case 'signupRequired':
      return {
        step: 'profile',
        // The code is used up — nothing to go back to.
        sent: null,
        signup: {
          phone: action.result.phone,
          signupToken: action.result.signupToken,
          expiresAt: action.now + Math.max(0, action.result.expiresInMinutes) * 60_000,
        },
        notice: null,
      };
    case 'restart':
      return { step: 'phone', sent: null, signup: null, notice: action.notice ?? null };
    default:
      return state;
  }
}

/** True once the signupToken has run out — sending it would only get 401. */
export function isSignupExpired(signup: PendingSignup, now: number): boolean {
  return now >= signup.expiresAt;
}

// The same, stamped with the time right now — for event handlers.

export function codeSentNow(result: PhoneSignInRequestResult): PhoneAuthAction {
  return { type: 'codeSent', result, now: Date.now() };
}

export function signupRequiredNow(result: PhoneSignupRequired): PhoneAuthAction {
  return { type: 'signupRequired', result, now: Date.now() };
}

export function isSignupExpiredNow(signup: PendingSignup): boolean {
  return isSignupExpired(signup, Date.now());
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/**
 * A failed POST /auth/phone/verify → the code field's message. Any 401 is a
 * wrong, expired or used-up code (CODE_INVALID — fixed wording, since a 401
 * without a message would otherwise read "session expired"); a 403 is the
 * server's (suspended account); anything else as in-app verification words it.
 */
export function phoneVerifyErrorMessage(error: Pick<NormalizedApiError, 'kind' | 'code' | 'message' | 'retryAfterSeconds'>): string {
  if (error.kind === 'unauthorized') return PHONE_ERROR_MESSAGES.CODE_INVALID;
  if (error.kind === 'forbidden') return error.message;
  return phoneVerificationErrorMessage(error);
}

export type PhoneRegisterFailure =
  // Back to the number step with this message.
  | { type: 'restart'; message: string }
  // Under a profile field; offerEmailSignIn shows "Sign in with email instead".
  | { type: 'field'; field: 'name' | 'email'; message: string; offerEmailSignIn: boolean }
  // Above the button.
  | { type: 'form'; message: string };

/**
 * A failed POST /auth/phone/register → what the profile step does:
 * - 401 SIGNUP_TOKEN_INVALID (any 401) → back to the number step;
 * - 409 PHONE_TAKEN (someone took the number since the code) → back to the
 *   number step, whose code now signs in to that account;
 * - 409 EMAIL_TAKEN → under the email, with the email sign-in link;
 * - a 400 about the name or email → under that field;
 * - anything else (403 IDENTITY_BLOCKED, offline, …) → the form, server's words.
 */
export function phoneRegisterFailure(error: Pick<NormalizedApiError, 'kind' | 'code' | 'message'>): PhoneRegisterFailure {
  if (error.kind === 'unauthorized' || error.code === PhoneAuthErrorCode.SIGNUP_TOKEN_INVALID) {
    return { type: 'restart', message: PHONE_SIGN_IN_MESSAGES.SIGNUP_EXPIRED };
  }
  if (error.code === PhoneErrorCode.PHONE_TAKEN) {
    return { type: 'restart', message: PHONE_SIGN_IN_MESSAGES.PHONE_TAKEN_ON_SIGNUP };
  }
  if (error.code === PhoneAuthErrorCode.EMAIL_TAKEN) {
    return {
      type: 'field',
      field: 'email',
      message: error.message || PHONE_SIGN_IN_MESSAGES.EMAIL_TAKEN,
      offerEmailSignIn: true,
    };
  }
  if (error.kind === 'validation') {
    if (/e-?mail/i.test(error.message)) return { type: 'field', field: 'email', message: error.message, offerEmailSignIn: false };
    if (/name/i.test(error.message)) return { type: 'field', field: 'name', message: error.message, offerEmailSignIn: false };
  }
  return { type: 'form', message: error.message };
}
