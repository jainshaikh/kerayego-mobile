// Pure helpers for 6-digit sign-in codes: the emailed code (plan A11, A21:
// POST /auth/code/request → POST /auth/code/verify, the email sign-in screen
// and its CodeEntryStep) and the WhatsApp ones (phone sign-in,
// features/auth/phoneSignIn.ts, and in-app phone verification). Unit-tested
// in signInCode.test.ts.

/** The code's length — kerayego-backend auth.service.ts verifyLoginCode. */
export const SIGN_IN_CODE_LENGTH = 6;

/**
 * Seconds before "Send again" works, when the server didn't say
 * (/auth/code/request and the WhatsApp code requests say 60).
 */
export const DEFAULT_RESEND_AFTER_SECONDS = 60;

/** Shown once after a sign-in whose response has deletionCancelled: true. */
export const DELETION_CANCELLED_MESSAGE = 'Welcome back. Your account deletion has been cancelled.';

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
