import { AxiosError } from 'axios';
import type { ApiErrorBody } from '../types/api.types';

export type ApiErrorKind =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'network'
  | 'server'
  | 'unknown';

export interface NormalizedApiError {
  kind: ApiErrorKind;
  message: string;
  statusCode?: number;
  fieldErrors?: { field?: string; message: string }[];
}

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

// Kinds that say nothing about the request itself, so resending it unchanged
// later can succeed: no answer at all (network), a server-side failure (5xx),
// throttling (429), or a 401 whose token refresh didn't go through. 'unknown'
// (a status kindFromStatus doesn't map, e.g. 408, or a non-HTTP error) is
// retried too, rather than risk discarding something that would have worked —
// a caller that retries must cap its attempts. validation/forbidden/
// not_found/conflict are the server's verdict on the request: the same
// request will get the same answer.
const RETRYABLE_KINDS: ReadonlySet<ApiErrorKind> = new Set<ApiErrorKind>([
  'network',
  'server',
  'rate_limited',
  'unauthorized',
  'unknown',
]);

export function isRetryableErrorKind(kind: ApiErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

const FRIENDLY_MESSAGES: Partial<Record<ApiErrorKind, string>> = {
  unauthorized: 'Your session has expired. Please log in again.',
  forbidden: "You don't have permission to do that.",
  not_found: 'We could not find what you were looking for.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  network: 'No connection. Check your internet and try again.',
  server: 'Something went wrong on our end. Please try again.',
  unknown: 'Something went wrong. Please try again.',
};

/** Normalizes any thrown error (Axios or otherwise) into a UI-safe shape. Never surfaces raw backend/stack details. */
export function normalizeApiError(error: unknown): NormalizedApiError {
  if (error instanceof AxiosError) {
    if (!error.response) {
      return { kind: 'network', message: FRIENDLY_MESSAGES.network! };
    }

    const status = error.response.status;
    const kind = kindFromStatus(status);
    const body = error.response.data as ApiErrorBody | undefined;
    const backendMessage = body?.error?.message;

    return {
      kind,
      statusCode: status,
      message: backendMessage || FRIENDLY_MESSAGES[kind] || FRIENDLY_MESSAGES.unknown!,
      fieldErrors: body?.error?.details,
    };
  }

  return { kind: 'unknown', message: FRIENDLY_MESSAGES.unknown! };
}
