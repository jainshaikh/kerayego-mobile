import type { NormalizedApiError } from '../../api/errors';

// Person blocks (backend plan A22/D18). A new or changed phone number that
// matches a person KerayeGo blocked puts the account on hold: the person can
// sign in and browse, but booking, posting trips, requesting seats and
// driving answer 403 IDENTITY_ON_HOLD until KerayeGo clears or blocks them.
// A CNIC or email that matches is refused outright with 403
// IDENTITY_BLOCKED — that one needs nothing special here: the screens show
// the server's message where they show any other error.

export const IDENTITY_ON_HOLD_CODE = 'IDENTITY_ON_HOLD';
export const IDENTITY_BLOCKED_CODE = 'IDENTITY_BLOCKED';

// The backend's hold message, word for word — shown from GET /users/me's
// identityHold flag before the person tries anything. A refused action
// shows the server's own message instead (normally this same text).
export const IDENTITY_HOLD_MESSAGE =
  'Your account is being checked by KerayeGo. You can browse, but booking, posting trips and driving are paused ' +
  'until the check is done — usually within a day.';

/** True for the 403 an action gets while the account is on hold. */
export function isIdentityHoldError(error: Pick<NormalizedApiError, 'code'>): boolean {
  return error.code === IDENTITY_ON_HOLD_CODE;
}

/**
 * The hold message a screen shows, or null for none: the server's message
 * from a refused action wins over the flag (it is the fresher answer), and
 * the flag alone shows the standard message.
 */
export function identityHoldNotice(onHold: boolean, refusedMessage: string | null): string | null {
  if (refusedMessage) return refusedMessage;
  return onHold ? IDENTITY_HOLD_MESSAGE : null;
}
