import { describe, expect, it, jest } from '@jest/globals';

import type { NormalizedApiError } from '../../api/errors';
import { Role, UserStatus } from '../../types/enums';
import type { AuthUser, User } from '../../types/api.types';
import {
  CODE_BY_MESSAGE,
  PHONE_ERROR_MESSAGES,
  WHATSAPP_TOGGLE_DESCRIPTION,
  WHATSAPP_TOGGLE_NEEDS_VERIFIED,
  codeDeliveryOf,
  formatPhoneForDisplay,
  mustMessageForCode,
  needsPhoneVerification,
  phoneOf,
  phoneVerificationErrorMessage,
  resendDelayAfterSend,
  sendCodeError,
  sendCodeErrorText,
  sentVerificationCode,
  sentVerificationCodeNow,
  userAfterPhoneNotVerified,
  verificationCodeIntro,
  whatsappToggleState,
  withWhatsappUpdates,
} from './phoneVerification';

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    name: 'Ali',
    email: 'ali@example.com',
    phone: '+923001234567',
    role: Role.USER,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function apiError(overrides: Partial<NormalizedApiError>): NormalizedApiError {
  return { kind: 'unknown', message: 'Something went wrong. Please try again.', ...overrides };
}

describe('the phone gate decision', () => {
  it('gates only when the backend says mustVerifyPhone', () => {
    expect(needsPhoneVerification(user({ mustVerifyPhone: true, phoneVerified: false }))).toBe(true);
    expect(needsPhoneVerification(user({ mustVerifyPhone: false, phoneVerified: false }))).toBe(false);
  });

  it('never gates on its own idea of verification (flag off: unverified but not required)', () => {
    expect(needsPhoneVerification(user({ phoneVerified: false }))).toBe(false);
    expect(needsPhoneVerification(user({ phone: null, phoneVerified: false, mustVerifyPhone: false }))).toBe(false);
  });

  it('does not gate a backend without the field, or nobody', () => {
    expect(needsPhoneVerification(user())).toBe(false);
    expect(needsPhoneVerification(null)).toBe(false);
    expect(needsPhoneVerification(undefined)).toBe(false);
  });

  it('works on the sign-in session user too', () => {
    const session: AuthUser = {
      id: 'u1',
      name: 'Ali',
      email: 'ali@example.com',
      role: Role.USER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      mustVerifyPhone: true,
    };
    expect(needsPhoneVerification(session)).toBe(true);
    expect(phoneOf(session)).toBeNull();
  });
});

describe('after a 403 PHONE_NOT_VERIFIED', () => {
  it('takes the re-read user, whose mustVerifyPhone decides', () => {
    const current = user({ mustVerifyPhone: false });
    const refetched = user({ mustVerifyPhone: true, phoneVerified: false });
    expect(userAfterPhoneNotVerified(current, refetched)).toBe(refetched);
    // The 403 was stale — verified meanwhile: no gate.
    const verified = user({ mustVerifyPhone: false, phoneVerified: true });
    expect(needsPhoneVerification(userAfterPhoneNotVerified(current, verified))).toBe(false);
  });

  it('marks the current user when the re-read failed', () => {
    const next = userAfterPhoneNotVerified(user({ mustVerifyPhone: false }), null);
    expect(next).toMatchObject({ id: 'u1', mustVerifyPhone: true });
    expect(needsPhoneVerification(next)).toBe(true);
  });

  it('ignores a re-read of another account, and a signed-out session', () => {
    const next = userAfterPhoneNotVerified(user(), user({ id: 'other', mustVerifyPhone: false }));
    expect(next).toMatchObject({ id: 'u1', mustVerifyPhone: true });
    expect(userAfterPhoneNotVerified(null, user({ mustVerifyPhone: true }))).toBeNull();
  });
});

describe('error code → message', () => {
  it.each([
    ['PHONE_TAKEN', 409, PHONE_ERROR_MESSAGES.PHONE_TAKEN],
    ['CODE_LIMIT_REACHED', 429, 'Too many codes today. Try again tomorrow.'],
    ['WHATSAPP_UNAVAILABLE', 503, PHONE_ERROR_MESSAGES.WHATSAPP_UNAVAILABLE],
  ])('%s (%i) → the fixed wording, whatever the server said', (code, statusCode, expected) => {
    expect(phoneVerificationErrorMessage(apiError({ code, statusCode, message: 'server words' }))).toBe(expected);
  });

  it('PHONE_TAKEN says to contact support', () => {
    expect(PHONE_ERROR_MESSAGES.PHONE_TAKEN).toBe('This number is on another KerayeGo account. Contact KerayeGo support.');
  });

  it("WHATSAPP_SEND_FAILED and CODE_INVALID show the server's message, with a fallback", () => {
    const sendFailed = "We couldn't send a WhatsApp message to this number. Check that it uses WhatsApp and try again.";
    expect(phoneVerificationErrorMessage(apiError({ code: 'WHATSAPP_SEND_FAILED', message: sendFailed }))).toBe(sendFailed);
    expect(phoneVerificationErrorMessage(apiError({ code: 'WHATSAPP_SEND_FAILED', message: '' }))).toBe(
      PHONE_ERROR_MESSAGES.WHATSAPP_SEND_FAILED,
    );
    const invalid = 'That code is wrong or has expired. Ask for a new one.';
    expect(phoneVerificationErrorMessage(apiError({ kind: 'validation', code: 'CODE_INVALID', message: invalid }))).toBe(
      invalid,
    );
    expect(phoneVerificationErrorMessage(apiError({ code: 'CODE_INVALID', message: '' }))).toBe(
      PHONE_ERROR_MESSAGES.CODE_INVALID,
    );
  });

  it("an invalid number (400) and anything else show the server's / friendly message", () => {
    const invalidNumber = 'Enter a valid mobile number, e.g. 03001234567 or +923001234567';
    expect(phoneVerificationErrorMessage(apiError({ kind: 'validation', code: 'BAD_REQUEST', message: invalidNumber }))).toBe(
      invalidNumber,
    );
    const offline = 'No connection. Check your internet and try again.';
    expect(phoneVerificationErrorMessage(apiError({ kind: 'network', message: offline }))).toBe(offline);
  });

  it('CODE_RESEND_TOO_SOON on its own reads as a wait', () => {
    expect(phoneVerificationErrorMessage(apiError({ code: 'CODE_RESEND_TOO_SOON', retryAfterSeconds: 42 }))).toBe(
      'Wait 42s before asking for another code.',
    );
  });
});

describe('the resend countdown', () => {
  const now = 1_000_000;

  it("starts from send-code's resendInSeconds, else 60 s", () => {
    expect(resendDelayAfterSend({ phone: '+923001234567', expiresInMinutes: 10, resendInSeconds: 45, channel: 'whatsapp' })).toBe(
      45,
    );
    expect(resendDelayAfterSend({ phone: '+923001234567', alreadyVerified: true })).toBe(60);
  });

  it("turns CODE_RESEND_TOO_SOON into a countdown from retryAfterSeconds", () => {
    const state = sendCodeError(apiError({ kind: 'rate_limited', code: 'CODE_RESEND_TOO_SOON', retryAfterSeconds: 30 }), now);
    expect(state).toEqual({ retryAt: now + 30_000 });
    expect(sendCodeErrorText(state, now)).toBe('Wait 30s before asking for another code.');
    expect(sendCodeErrorText(state, now + 10_400)).toBe('Wait 20s before asking for another code.');
    expect(sendCodeErrorText(state, now + 29_001)).toBe('Wait 1s before asking for another code.');
    // Over: no message, the button works again.
    expect(sendCodeErrorText(state, now + 30_000)).toBeNull();
  });

  it('falls back to 60 s when the 429 carries no retryAfterSeconds', () => {
    const state = sendCodeError(apiError({ kind: 'rate_limited', code: 'CODE_RESEND_TOO_SOON' }), now);
    expect(state).toEqual({ retryAt: now + 60_000 });
  });

  it('keeps every other send error as a plain message', () => {
    const state = sendCodeError(apiError({ kind: 'rate_limited', code: 'CODE_LIMIT_REACHED' }), now);
    expect(state).toEqual({ message: 'Too many codes today. Try again tomorrow.' });
    expect(sendCodeErrorText(state, now + 999_999)).toBe('Too many codes today. Try again tomorrow.');
    expect(sendCodeErrorText(null, now)).toBeNull();
  });
});

describe('phone display', () => {
  it('spaces a Pakistani E.164 number', () => {
    expect(formatPhoneForDisplay('+923001234567')).toBe('+92 300 1234567');
  });

  it('leaves anything else as it is', () => {
    expect(formatPhoneForDisplay('+966501234567')).toBe('+966501234567');
    expect(formatPhoneForDisplay('03001234567')).toBe('03001234567');
    expect(formatPhoneForDisplay(null)).toBe('');
  });
});

describe('the "WhatsApp updates" switch', () => {
  it('is on by default and usable with a verified number', () => {
    expect(whatsappToggleState(user({ phoneVerified: true }))).toEqual({
      value: true,
      disabled: false,
      helper: WHATSAPP_TOGGLE_DESCRIPTION,
    });
    expect(whatsappToggleState(user({ phoneVerified: true, whatsappUpdates: false })).value).toBe(false);
  });

  it('is disabled with "Verify your number first" until the number is verified', () => {
    expect(whatsappToggleState(user({ phoneVerified: false, whatsappUpdates: true }))).toEqual({
      value: true,
      disabled: true,
      helper: WHATSAPP_TOGGLE_NEEDS_VERIFIED,
    });
    expect(whatsappToggleState(undefined).disabled).toBe(true);
  });

  it('withWhatsappUpdates copies, never mutates', () => {
    const before = user({ whatsappUpdates: true });
    const after = withWhatsappUpdates(before, false);
    expect(after.whatsappUpdates).toBe(false);
    expect(before.whatsappUpdates).toBe(true);
  });
});

describe('"Get the code on WhatsApp" (message us for your code)', () => {
  const url = 'https://wa.me/923103810011?text=Send%20my%20KerayeGo%20code';
  const sendResult = { phone: '+923001234567', expiresInMinutes: 10, resendInSeconds: 60, channel: 'whatsapp' as const };

  it('treats an older backend (neither field) as sent, with no link', () => {
    expect(codeDeliveryOf({})).toEqual({ codeSent: true, messageUsUrl: null });
    expect(mustMessageForCode(codeDeliveryOf({}))).toBe(false);
  });

  it('keeps codeSent and an https link as sent', () => {
    expect(codeDeliveryOf({ codeSent: true, messageUsUrl: url })).toEqual({ codeSent: true, messageUsUrl: url });
    expect(codeDeliveryOf({ codeSent: false, messageUsUrl: ` ${url} ` })).toEqual({ codeSent: false, messageUsUrl: url });
  });

  it('never keeps a link that is not https', () => {
    expect(codeDeliveryOf({ codeSent: false, messageUsUrl: 'javascript:alert(1)' }).messageUsUrl).toBeNull();
    expect(codeDeliveryOf({ codeSent: false, messageUsUrl: '' }).messageUsUrl).toBeNull();
  });

  it('leads with the link only when the code was not sent and the link is there', () => {
    expect(mustMessageForCode({ codeSent: false, messageUsUrl: url })).toBe(true);
    expect(mustMessageForCode({ codeSent: true, messageUsUrl: url })).toBe(false);
    // codeSent: false without a link is the testing code — today's wording.
    expect(mustMessageForCode({ codeSent: false, messageUsUrl: null })).toBe(false);
  });

  it("words the verification code step's line for each case", () => {
    expect(verificationCodeIntro('+923001234567', { codeSent: true, messageUsUrl: url })).toBe(
      'Sent to WhatsApp +92 300 1234567',
    );
    expect(verificationCodeIntro('+923001234567', { codeSent: false, messageUsUrl: url })).toBe(
      'Tap below to get the code for +92 300 1234567 on WhatsApp.',
    );
    expect(verificationCodeIntro('+923001234567', { codeSent: false, messageUsUrl: null })).toBe(
      'Sent to WhatsApp +92 300 1234567',
    );
    expect(CODE_BY_MESSAGE.BUTTON).toBe('Get the code on WhatsApp');
  });

  it("turns a send-code result into the code step's state", () => {
    const now = 1_000_000;
    expect(sentVerificationCode({ ...sendResult, codeSent: false, messageUsUrl: url }, now)).toEqual({
      phone: '+923001234567',
      expiresInMinutes: 10,
      resendAt: now + 60_000,
      codeSent: false,
      messageUsUrl: url,
    });
    expect(sentVerificationCode({ ...sendResult, resendInSeconds: 30 }, now)).toEqual({
      phone: '+923001234567',
      expiresInMinutes: 10,
      resendAt: now + 30_000,
      codeSent: true,
      messageUsUrl: null,
    });
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect(sentVerificationCodeNow(sendResult)).toEqual(sentVerificationCode(sendResult, now));
    } finally {
      spy.mockRestore();
    }
  });
});
