import { describe, expect, it } from '@jest/globals';

import {
  DELETION_REASON_MAX_LENGTH,
  deletionScheduledMessage,
  formatDeletionDate,
  toDeletionRequestPayload,
} from './accountDeletion';

describe('toDeletionRequestPayload', () => {
  it('sends no reason when it is blank', () => {
    expect(toDeletionRequestPayload('')).toEqual({});
    expect(toDeletionRequestPayload('   \n ')).toEqual({});
    expect(toDeletionRequestPayload(undefined)).toEqual({});
    expect(toDeletionRequestPayload(null)).toEqual({});
  });

  it('trims the reason', () => {
    expect(toDeletionRequestPayload('  Moving abroad \n')).toEqual({ reason: 'Moving abroad' });
  });

  it('never sends more than the backend limit', () => {
    const payload = toDeletionRequestPayload('a'.repeat(DELETION_REASON_MAX_LENGTH + 20));
    expect(payload.reason).toHaveLength(DELETION_REASON_MAX_LENGTH);
  });
});

describe('formatDeletionDate', () => {
  it('formats the date and time', () => {
    expect(formatDeletionDate('2026-11-01T15:00:00.000Z', 'en-US', 'UTC')).toBe(
      'Sunday, November 1, 2026 at 3:00 PM',
    );
  });

  it('returns null for an unreadable date', () => {
    expect(formatDeletionDate('not a date', 'en-US', 'UTC')).toBeNull();
  });
});

describe('deletionScheduledMessage', () => {
  it('names the date and both ways to cancel', () => {
    expect(deletionScheduledMessage('2026-11-01T15:00:00.000Z', 'en-US', 'UTC')).toBe(
      'Your account will be deleted on Sunday, November 1, 2026 at 3:00 PM. ' +
        'To cancel, sign in again before then, or use the link in the email we sent you.',
    );
  });

  it('falls back to "in 72 hours" without a readable date', () => {
    expect(deletionScheduledMessage('', 'en-US', 'UTC')).toBe(
      'Your account will be deleted in 72 hours. ' +
        'To cancel, sign in again before then, or use the link in the email we sent you.',
    );
  });
});
