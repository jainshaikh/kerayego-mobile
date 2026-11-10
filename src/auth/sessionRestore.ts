import { normalizeApiError, type ApiErrorKind } from '../api/errors';

// Restoring the stored session on app start (AuthProvider's bootstrap):
// stored refresh token → POST /auth/refresh → GET /users/me. Unit-tested in
// sessionRestore.test.ts.

/** How often a session restore that couldn't reach the server is tried again, while the app is open. */
export const SESSION_RESTORE_RETRY_MS = 15_000;

// Failures that say nothing about the session itself — no connection, a
// timeout, server trouble, throttling, or something that isn't an HTTP answer
// at all (e.g. the keychain not readable yet) — so the stored refresh token is
// kept and the restore tried again. Everything else is the server's verdict on
// the session (401 after a refused refresh, 403 suspended, 404, …): sign out.
const KEEP_SESSION_KINDS: ReadonlySet<ApiErrorKind> = new Set<ApiErrorKind>(['network', 'server', 'rate_limited', 'unknown']);

export type SessionRestoreFailureAction = 'retry' | 'signOut';

/** What to do when restoring the stored session throws. */
export function sessionRestoreFailureAction(error: unknown): SessionRestoreFailureAction {
  return KEEP_SESSION_KINDS.has(normalizeApiError(error).kind) ? 'retry' : 'signOut';
}
