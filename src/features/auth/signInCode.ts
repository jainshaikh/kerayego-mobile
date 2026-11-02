import type { NormalizedApiError } from '../../api/errors';

// Pure helpers for email-code sign-in and sign-up (plan A11, A21, A23):
// POST /auth/code/request → POST /auth/code/verify, and POST /auth/register
// without a password. Used by the login and register screens and their
// shared CodeEntryStep; unit-tested in signInCode.test.ts.

/** The code's length — kerayego-backend auth.service.ts verifyLoginCode. */
export const SIGN_IN_CODE_LENGTH = 6;

/**
 * Seconds before "Send again" works, when the server didn't say
 * (POST /auth/register has no resendAfterSeconds; /auth/code/request says 60).
 */
export const DEFAULT_RESEND_AFTER_SECONDS = 60;

/** Shown once after a sign-in whose response has deletionCancelled: true. */
export const DELETION_CANCELLED_MESSAGE = 'Welcome back. Your account deletion has been cancelled.';

/** The mobile-number hint on sign-up and the profile. */
export const PHONE_HINT = 'e.g. 03001234567';

/**
 * What the code field keeps from what was typed or pasted: digits only, at
 * most 6 ("123 456" and "Code: 123456" both become "123456").
 */
export function normalizeCodeInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, SIGN_IN_CODE_LENGTH);
}

/** True once the field holds exactly 6 digits — only then is it sent. */
export function isCompleteCode(code: string): boolean {
  return new RegExp(`^\\d{${SIGN_IN_CODE_LENGTH}}$`).test(code);
}

/**
 * The server's resendAfterSeconds when it's a sane number, else the default.
 */
export function resendDelaySeconds(fromServer: unknown): number {
  return typeof fromServer === 'number' && Number.isFinite(fromServer) && fromServer >= 0
    ? Math.ceil(fromServer)
    : DEFAULT_RESEND_AFTER_SECONDS;
}

/** When "Send again" becomes available, for a code sent at `sentAt` (ms). */
export function resendAvailableAt(sentAt: number, delaySeconds: number): number {
  return sentAt + Math.max(0, delaySeconds) * 1000;
}

/** When "Send again" becomes available for a code sent just now. */
export function resendAvailableFromNow(delaySeconds: number): number {
  return resendAvailableAt(Date.now(), delaySeconds);
}

/** Whole seconds left before "Send again" works — 0 once it does. */
export function resendSecondsLeft(availableAt: number, now: number): number {
  return Math.max(0, Math.ceil((availableAt - now) / 1000));
}

/** The "Send again" button's label for the seconds left. */
export function resendLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `Send again in ${secondsLeft}s` : 'Send again';
}

export type SignUpErrorField = 'phone' | 'email' | 'form';

/**
 * Which sign-up (or profile) field a server error belongs under. The message
 * itself is always the server's, via normalizeApiError:
 * - 409 PHONE_TAKEN, or a 400 about the mobile number → the phone field;
 * - any other 409 ("An account with this email already exists") → email;
 * - anything else (CODE_INVALID, offline, blocked email, …) → the form.
 */
export function signUpErrorField(error: Pick<NormalizedApiError, 'kind' | 'code' | 'message'>): SignUpErrorField {
  if (error.code === 'PHONE_TAKEN') return 'phone';
  if (error.kind === 'validation' && /mobile number|phone/i.test(error.message)) return 'phone';
  if (error.kind === 'conflict') return 'email';
  return 'form';
}
