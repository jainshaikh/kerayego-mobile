import type { NormalizedApiError } from '../../api/errors';
import { PhoneErrorCode, type AuthUser, type PhoneSendCodeResult, type User } from '../../types/api.types';
import { DEFAULT_RESEND_AFTER_SECONDS, resendDelaySeconds } from '../auth/signInCode';

// Pure helpers for WhatsApp phone verification (2026-11): the blocking
// "Verify your mobile number" screen (POST /users/me/phone/send-code →
// POST /users/me/phone/verify), the profile's phone row and the "WhatsApp
// updates" setting. Unit-tested in phoneVerification.test.ts.

type AnyUser = AuthUser | User;

/** Step 1's small print. */
export const WHATSAPP_UPDATES_SMALL_PRINT =
  "We'll also send your booking updates on WhatsApp. You can turn them off in Settings.";

/** The phone field's hint. */
export const PHONE_VERIFY_HINT = 'e.g. 03001234567 or +923001234567';

export const PHONE_ERROR_MESSAGES = {
  PHONE_TAKEN: 'This number is on another KerayeGo account. Contact KerayeGo support.',
  CODE_LIMIT_REACHED: 'Too many codes today. Try again tomorrow.',
  WHATSAPP_SEND_FAILED:
    "We couldn't send a WhatsApp message to this number. Check that it uses WhatsApp and try again.",
  WHATSAPP_UNAVAILABLE: "WhatsApp codes aren't available right now. Please try again later.",
  CODE_INVALID: 'That code is wrong or has expired. Ask for a new one.',
} as const;

export const WHATSAPP_TOGGLE_LABEL = 'WhatsApp updates';
export const WHATSAPP_TOGGLE_DESCRIPTION = 'Booking and trip updates on WhatsApp';
export const WHATSAPP_TOGGLE_NEEDS_VERIFIED = 'Verify your number first';

// ─── The gate ───────────────────────────────────────────────────────────────

/**
 * True when the signed-in account must verify its number before using the
 * app — the backend's own verdict (user.mustVerifyPhone), never worked out
 * here. A backend without the field never gates.
 */
export function needsPhoneVerification(user: AnyUser | null | undefined): boolean {
  return !!user && user.mustVerifyPhone === true;
}

/**
 * The user to keep after a 403 PHONE_NOT_VERIFIED, once GET /users/me has
 * been re-read (`refetched`, or null if that read failed):
 * - signed out meanwhile (no current user) → stays signed out;
 * - the re-read user, when it is the same account → it (its mustVerifyPhone
 *   decides — the 403 may already be stale);
 * - the read failed → the current user marked mustVerifyPhone: the server
 *   just said so.
 */
export function userAfterPhoneNotVerified<T extends AnyUser>(current: T | null, refetched: User | null): T | User | null {
  if (!current) return current;
  if (refetched && refetched.id === current.id) return refetched;
  return { ...current, mustVerifyPhone: true };
}

// ─── Phone display ──────────────────────────────────────────────────────────

/**
 * An E.164 number for reading: "+923001234567" → "+92 300 1234567". Anything
 * that isn't a Pakistani mobile number in E.164 comes back unchanged.
 */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return '';
  const pk = /^\+92(\d{3})(\d{7})$/.exec(phone.trim());
  return pk ? `+92 ${pk[1]} ${pk[2]}` : phone.trim();
}

/** The account's mobile number (AuthUser from a sign-in has none). */
export function phoneOf(user: AnyUser | null | undefined): string | null {
  return user && 'phone' in user ? (user.phone ?? null) : null;
}

// ─── Send-code / verify errors ──────────────────────────────────────────────

/** What a failed send-code leaves on screen. */
export type SendCodeError =
  // A message for the phone field.
  | { message: string }
  // CODE_RESEND_TOO_SOON: a countdown until another code may be asked for.
  | { retryAt: number };

/** Seconds before another code may be asked for, after a send-code result. */
export function resendDelayAfterSend(result: PhoneSendCodeResult): number {
  return 'resendInSeconds' in result ? resendDelaySeconds(result.resendInSeconds) : DEFAULT_RESEND_AFTER_SECONDS;
}

/**
 * A failed POST /users/me/phone/send-code → what to show. `now` is ms.
 * CODE_RESEND_TOO_SOON becomes a countdown (retryAfterSeconds, else 60 s);
 * every other code has its own message; anything else (400 invalid number,
 * offline, …) shows the server's / the friendly message.
 */
export function sendCodeError(error: NormalizedApiError, now: number): SendCodeError {
  if (error.code === PhoneErrorCode.CODE_RESEND_TOO_SOON) {
    return { retryAt: now + resendDelaySeconds(error.retryAfterSeconds) * 1000 };
  }
  return { message: phoneVerificationErrorMessage(error) };
}

/** sendCodeError for an error that just happened. */
export function sendCodeErrorNow(error: NormalizedApiError): SendCodeError {
  return sendCodeError(error, Date.now());
}

/** The text for a SendCodeError at `now` (ms) — null once a countdown is over. */
export function sendCodeErrorText(state: SendCodeError | null, now: number): string | null {
  if (!state) return null;
  if ('message' in state) return state.message;
  const seconds = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  return seconds > 0 ? resendTooSoonMessage(seconds) : null;
}

export function resendTooSoonMessage(secondsLeft: number): string {
  return `Wait ${secondsLeft}s before asking for another code.`;
}

/**
 * The message for any send-code / verify error. Fixed wording for the codes
 * the contract words itself; the server's message where it is the useful one
 * (WHATSAPP_SEND_FAILED, CODE_INVALID, a 400 about the number).
 */
export function phoneVerificationErrorMessage(error: Pick<NormalizedApiError, 'code' | 'message' | 'retryAfterSeconds'>): string {
  switch (error.code) {
    case PhoneErrorCode.PHONE_TAKEN:
      return PHONE_ERROR_MESSAGES.PHONE_TAKEN;
    case PhoneErrorCode.CODE_LIMIT_REACHED:
      return PHONE_ERROR_MESSAGES.CODE_LIMIT_REACHED;
    case PhoneErrorCode.WHATSAPP_UNAVAILABLE:
      return PHONE_ERROR_MESSAGES.WHATSAPP_UNAVAILABLE;
    case PhoneErrorCode.WHATSAPP_SEND_FAILED:
      return error.message || PHONE_ERROR_MESSAGES.WHATSAPP_SEND_FAILED;
    case PhoneErrorCode.CODE_INVALID:
      return error.message || PHONE_ERROR_MESSAGES.CODE_INVALID;
    case PhoneErrorCode.CODE_RESEND_TOO_SOON:
      return resendTooSoonMessage(resendDelaySeconds(error.retryAfterSeconds));
    default:
      return error.message;
  }
}

// ─── "WhatsApp updates" setting ─────────────────────────────────────────────

export interface WhatsappToggleState {
  value: boolean;
  disabled: boolean;
  /** Under the switch: why it's off-limits, else the description. */
  helper: string;
}

/** The switch for a user: on unless turned off; usable only with a verified number. */
export function whatsappToggleState(user: AnyUser | null | undefined): WhatsappToggleState {
  const verified = user?.phoneVerified === true;
  return {
    value: user?.whatsappUpdates ?? true,
    disabled: !verified,
    helper: verified ? WHATSAPP_TOGGLE_DESCRIPTION : WHATSAPP_TOGGLE_NEEDS_VERIFIED,
  };
}

/** The user with the setting changed — the optimistic copy. */
export function withWhatsappUpdates<T extends AnyUser>(user: T, whatsappUpdates: boolean): T {
  return { ...user, whatsappUpdates };
}
