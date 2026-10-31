import { describe, expect, it } from '@jest/globals';

import {
  IDENTITY_BLOCKED_CODE,
  IDENTITY_HOLD_MESSAGE,
  IDENTITY_ON_HOLD_CODE,
  identityHoldNotice,
  isIdentityHoldError,
} from './identityHold';

describe('isIdentityHoldError', () => {
  it('is true only for the IDENTITY_ON_HOLD code', () => {
    expect(isIdentityHoldError({ code: IDENTITY_ON_HOLD_CODE })).toBe(true);
    // A refusal is shown as a plain form error, not as a hold.
    expect(isIdentityHoldError({ code: IDENTITY_BLOCKED_CODE })).toBe(false);
    expect(isIdentityHoldError({ code: 'FORBIDDEN' })).toBe(false);
    expect(isIdentityHoldError({})).toBe(false);
  });
});

describe('identityHoldNotice', () => {
  it('shows nothing when the account is not on hold and nothing was refused', () => {
    expect(identityHoldNotice(false, null)).toBeNull();
  });

  it('shows the standard hold message from the flag alone', () => {
    expect(identityHoldNotice(true, null)).toBe(IDENTITY_HOLD_MESSAGE);
  });

  it("prefers a refused action's server message, even before the flag has caught up", () => {
    expect(identityHoldNotice(false, 'Server says: on hold')).toBe('Server says: on hold');
    expect(identityHoldNotice(true, 'Server says: on hold')).toBe('Server says: on hold');
  });
});
