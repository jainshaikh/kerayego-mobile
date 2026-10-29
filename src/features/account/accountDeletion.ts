// Pure helpers for the "Delete account" screen (src/app/account/delete-account.tsx).
// Contract: POST /users/me/delete-request { reason?: string (≤500) } →
// { message, scheduledFor (ISO), status: 'PENDING_DELETION' }. Plan A16, A51.

/** The backend's limit on the optional reason (DeleteAccountRequestDto). */
export const DELETION_REASON_MAX_LENGTH = 500;

export interface DeletionRequestPayload {
  reason?: string;
}

/** The request body: the trimmed reason, or nothing at all when it's blank. */
export function toDeletionRequestPayload(reason: string | null | undefined): DeletionRequestPayload {
  const trimmed = (reason ?? '').trim().slice(0, DELETION_REASON_MAX_LENGTH);
  return trimmed ? { reason: trimmed } : {};
}

/**
 * e.g. "Sunday, November 1, 2026 at 3:00 PM", in the phone's own zone (the
 * person is reading about their own deadline). Null for an unreadable date.
 * `locale`/`timeZone` are only for tests.
 */
export function formatDeletionDate(iso: string, locale?: string, timeZone?: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'short', timeZone };
  try {
    return date.toLocaleString(locale, options);
  } catch {
    return date.toLocaleString(locale);
  }
}

/** The message shown once the request succeeds (contract: "Clients"). */
export function deletionScheduledMessage(scheduledFor: string, locale?: string, timeZone?: string): string {
  const when = formatDeletionDate(scheduledFor, locale, timeZone);
  const first = when ? `Your account will be deleted on ${when}.` : 'Your account will be deleted in 72 hours.';
  return `${first} To cancel, sign in again before then, or use the link in the email we sent you.`;
}
