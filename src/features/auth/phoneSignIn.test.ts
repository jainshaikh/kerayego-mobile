import { describe, expect, it, jest } from '@jest/globals';

import { CODE_BY_MESSAGE, PHONE_ERROR_MESSAGES } from '../phone-verification/phoneVerification';
import { Market } from '../../types/enums';
import type { PhoneSignInRequestResult, PhoneSignupRequired } from '../../types/api.types';
import {
  DEFAULT_PHONE_COUNTRY,
  INITIAL_PHONE_AUTH_STATE,
  PHONE_SIGN_IN_MESSAGES,
  codeSentNow,
  codeStepMessage,
  composePhoneNumber,
  isSignupExpired,
  isSignupExpiredNow,
  phoneAuthReducer,
  phoneCountryLabel,
  phoneRegisterFailure,
  phoneVerifyErrorMessage,
  signupRequiredNow,
  type PhoneAuthState,
} from './phoneSignIn';

const NOW = 1_800_000_000_000;

const requestResult: PhoneSignInRequestResult = {
  phone: '+923001234567',
  expiresInMinutes: 10,
  resendInSeconds: 60,
  channel: 'whatsapp',
};

const signupRequired: PhoneSignupRequired = {
  needsSignup: true,
  phone: '+923001234567',
  signupToken: 'jwt',
  expiresInMinutes: 30,
};

describe('composePhoneNumber', () => {
  it('puts Pakistan’s +92 in front of a local number, without its leading 0', () => {
    expect(composePhoneNumber('03001234567', Market.PK)).toBe('+923001234567');
    expect(composePhoneNumber('0300 123-4567', Market.PK)).toBe('+923001234567');
    expect(composePhoneNumber('3001234567', Market.PK)).toBe('+923001234567');
  });

  it('uses the chosen country’s calling code', () => {
    expect(composePhoneNumber('050 123 4567', Market.SA)).toBe('+966501234567');
    expect(composePhoneNumber('0501234567', Market.AE)).toBe('+971501234567');
  });

  it('keeps a number typed in international form as it is', () => {
    expect(composePhoneNumber('+966501234567', Market.PK)).toBe('+966501234567');
    expect(composePhoneNumber(' 00971501234567 ', Market.PK)).toBe('00971501234567');
  });

  it('adds only the + to digits that already start with the calling code', () => {
    expect(composePhoneNumber('923001234567', Market.PK)).toBe('+923001234567');
    expect(composePhoneNumber('966501234567', Market.SA)).toBe('+966501234567');
  });

  it('defaults to Pakistan and labels each country with its code', () => {
    expect(DEFAULT_PHONE_COUNTRY).toBe(Market.PK);
    expect(phoneCountryLabel(Market.PK)).toBe('Pakistan +92');
    expect(phoneCountryLabel(Market.SA)).toBe('Saudi Arabia +966');
  });
});

describe('phoneAuthReducer', () => {
  const onCode = phoneAuthReducer(INITIAL_PHONE_AUTH_STATE, { type: 'codeSent', result: requestResult, now: NOW });

  it('starts on the number step', () => {
    expect(INITIAL_PHONE_AUTH_STATE).toEqual({ step: 'phone', sent: null, signup: null, notice: null });
  });

  it('goes to the code step with the server’s number and countdown', () => {
    expect(onCode).toEqual({
      step: 'code',
      sent: {
        phone: '+923001234567',
        expiresInMinutes: 10,
        resendAt: NOW + 60_000,
        // An older backend: sent, no "Get the code on WhatsApp" link.
        codeSent: true,
        messageUsUrl: null,
      },
      signup: null,
      notice: null,
    });
  });

  it('keeps codeSent and messageUsUrl from the send, and "Send again" replaces them', () => {
    const url = 'https://wa.me/923103810011?text=Send%20my%20KerayeGo%20code';
    const notSent = phoneAuthReducer(INITIAL_PHONE_AUTH_STATE, {
      type: 'codeSent',
      result: { ...requestResult, codeSent: false, messageUsUrl: url, message: 'Send us a message…' },
      now: NOW,
    });
    expect(notSent.step).toBe('code');
    expect(notSent.sent).toMatchObject({ codeSent: false, messageUsUrl: url });
    expect(codeStepMessage(notSent.sent!)).toBe(CODE_BY_MESSAGE.TAP_BELOW);

    const resent = phoneAuthReducer(notSent, {
      type: 'codeSent',
      result: { ...requestResult, codeSent: true, messageUsUrl: url },
      now: NOW + 61_000,
    });
    expect(resent.sent).toMatchObject({ codeSent: true, messageUsUrl: url, resendAt: NOW + 121_000 });
    expect(codeStepMessage(resent.sent!)).toBe(PHONE_SIGN_IN_MESSAGES.CODE_SENT);

    // A later send without the link (path turned off) drops it.
    const plain = phoneAuthReducer(resent, { type: 'codeSent', result: requestResult, now: NOW });
    expect(plain.sent).toMatchObject({ codeSent: true, messageUsUrl: null });
  });

  it('keeps the link through "Change" and a moved countdown', () => {
    const url = 'https://wa.me/923103810011?text=Send%20my%20KerayeGo%20code';
    const notSent = phoneAuthReducer(INITIAL_PHONE_AUTH_STATE, {
      type: 'codeSent',
      result: { ...requestResult, codeSent: false, messageUsUrl: url },
      now: NOW,
    });
    const delayed = phoneAuthReducer(notSent, { type: 'resendDelayed', retryAt: NOW + 5_000 });
    expect(delayed.sent).toMatchObject({ codeSent: false, messageUsUrl: url });
    const back = phoneAuthReducer(phoneAuthReducer(delayed, { type: 'changeNumber' }), { type: 'backToCode' });
    expect(back.sent).toMatchObject({ codeSent: false, messageUsUrl: url });
  });

  it('falls back to a 60 s countdown when resendInSeconds is missing or odd', () => {
    const odd = { ...requestResult, resendInSeconds: Number.NaN };
    const state = phoneAuthReducer(INITIAL_PHONE_AUTH_STATE, { type: 'codeSent', result: odd, now: NOW });
    expect(state.sent?.resendAt).toBe(NOW + 60_000);
  });

  it('moves the countdown on CODE_RESEND_TOO_SOON, and ignores it with no code sent', () => {
    expect(phoneAuthReducer(onCode, { type: 'resendDelayed', retryAt: NOW + 5_000 }).sent?.resendAt).toBe(NOW + 5_000);
    expect(phoneAuthReducer(INITIAL_PHONE_AUTH_STATE, { type: 'resendDelayed', retryAt: 1 })).toBe(
      INITIAL_PHONE_AUTH_STATE,
    );
  });

  it('"Change" goes back to the number step keeping the sent code, which "Enter the code" returns to', () => {
    const changed = phoneAuthReducer(onCode, { type: 'changeNumber' });
    expect(changed.step).toBe('phone');
    expect(changed.sent).toEqual(onCode.sent);
    expect(phoneAuthReducer(changed, { type: 'backToCode' })).toEqual(onCode);
  });

  it('cannot go back to a code that was never sent', () => {
    expect(phoneAuthReducer(INITIAL_PHONE_AUTH_STATE, { type: 'backToCode' })).toBe(INITIAL_PHONE_AUTH_STATE);
  });

  it('goes to the profile step on needsSignup, with the token’s expiry', () => {
    const profile = phoneAuthReducer(onCode, { type: 'signupRequired', result: signupRequired, now: NOW });
    expect(profile).toEqual({
      step: 'profile',
      sent: null,
      signup: { phone: '+923001234567', signupToken: 'jwt', expiresAt: NOW + 30 * 60_000 },
      notice: null,
    });
  });

  it('restarts at the number step, forgetting the code and token', () => {
    const profile = phoneAuthReducer(onCode, { type: 'signupRequired', result: signupRequired, now: NOW });
    const withNotice: PhoneAuthState = phoneAuthReducer(profile, {
      type: 'restart',
      notice: PHONE_SIGN_IN_MESSAGES.SIGNUP_EXPIRED,
    });
    expect(withNotice).toEqual({ step: 'phone', sent: null, signup: null, notice: PHONE_SIGN_IN_MESSAGES.SIGNUP_EXPIRED });
    expect(phoneAuthReducer(profile, { type: 'restart' }).notice).toBeNull();
  });

  it('clears a notice once a new code is sent', () => {
    const restarted = phoneAuthReducer(onCode, { type: 'restart', notice: 'x' });
    expect(phoneAuthReducer(restarted, { type: 'codeSent', result: requestResult, now: NOW }).notice).toBeNull();
  });
});

describe('isSignupExpired', () => {
  const signup = { phone: '+923001234567', signupToken: 'jwt', expiresAt: NOW };
  it('is true from the expiry on', () => {
    expect(isSignupExpired(signup, NOW - 1)).toBe(false);
    expect(isSignupExpired(signup, NOW)).toBe(true);
  });
});

describe('the *Now helpers', () => {
  it('stamp the actions and the expiry check with the time right now', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      expect(codeSentNow(requestResult)).toEqual({ type: 'codeSent', result: requestResult, now: NOW });
      expect(signupRequiredNow(signupRequired)).toEqual({ type: 'signupRequired', result: signupRequired, now: NOW });
      expect(isSignupExpiredNow({ phone: '+923001234567', signupToken: 'jwt', expiresAt: NOW + 1 })).toBe(false);
      expect(isSignupExpiredNow({ phone: '+923001234567', signupToken: 'jwt', expiresAt: NOW })).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('phoneVerifyErrorMessage', () => {
  it('words any 401 as a wrong or expired code (never "session expired")', () => {
    expect(
      phoneVerifyErrorMessage({ kind: 'unauthorized', code: 'CODE_INVALID', message: 'Invalid or expired code' }),
    ).toBe(PHONE_ERROR_MESSAGES.CODE_INVALID);
    expect(
      phoneVerifyErrorMessage({ kind: 'unauthorized', message: 'Your session has expired. Please log in again.' }),
    ).toBe(PHONE_ERROR_MESSAGES.CODE_INVALID);
  });

  it('shows the server’s words for a 403 (suspended account)', () => {
    const message = 'Your account has been suspended. Please contact support.';
    expect(phoneVerifyErrorMessage({ kind: 'forbidden', code: 'FORBIDDEN', message })).toBe(message);
  });

  it('words the other codes as in-app verification does', () => {
    expect(phoneVerifyErrorMessage({ kind: 'rate_limited', code: 'CODE_LIMIT_REACHED', message: 'x' })).toBe(
      PHONE_ERROR_MESSAGES.CODE_LIMIT_REACHED,
    );
    expect(phoneVerifyErrorMessage({ kind: 'network', message: 'No connection.' })).toBe('No connection.');
  });
});

describe('phoneRegisterFailure', () => {
  it('sends SIGNUP_TOKEN_INVALID (any 401) back to the number step', () => {
    expect(phoneRegisterFailure({ kind: 'unauthorized', code: 'SIGNUP_TOKEN_INVALID', message: 'x' })).toEqual({
      type: 'restart',
      message: PHONE_SIGN_IN_MESSAGES.SIGNUP_EXPIRED,
    });
    expect(phoneRegisterFailure({ kind: 'unauthorized', message: 'x' }).type).toBe('restart');
  });

  it('sends PHONE_TAKEN back to the number step too', () => {
    expect(phoneRegisterFailure({ kind: 'conflict', code: 'PHONE_TAKEN', message: 'x' })).toEqual({
      type: 'restart',
      message: PHONE_SIGN_IN_MESSAGES.PHONE_TAKEN_ON_SIGNUP,
    });
  });

  it('puts EMAIL_TAKEN under the email, offering the email sign-in', () => {
    const message = 'An account with this email already exists. Sign in with email instead.';
    expect(phoneRegisterFailure({ kind: 'conflict', code: 'EMAIL_TAKEN', message })).toEqual({
      type: 'field',
      field: 'email',
      message,
      offerEmailSignIn: true,
    });
    expect(phoneRegisterFailure({ kind: 'conflict', code: 'EMAIL_TAKEN', message: '' })).toMatchObject({
      message: PHONE_SIGN_IN_MESSAGES.EMAIL_TAKEN,
    });
  });

  it('puts a 400 about the email or name under that field', () => {
    expect(phoneRegisterFailure({ kind: 'validation', message: 'email must be an email' })).toMatchObject({
      type: 'field',
      field: 'email',
      offerEmailSignIn: false,
    });
    expect(phoneRegisterFailure({ kind: 'validation', message: 'name must be shorter than 100' })).toMatchObject({
      type: 'field',
      field: 'name',
    });
  });

  it('shows anything else (IDENTITY_BLOCKED, offline) above the button', () => {
    expect(phoneRegisterFailure({ kind: 'forbidden', code: 'IDENTITY_BLOCKED', message: 'Blocked' })).toEqual({
      type: 'form',
      message: 'Blocked',
    });
    expect(phoneRegisterFailure({ kind: 'network', message: 'No connection.' })).toEqual({
      type: 'form',
      message: 'No connection.',
    });
  });
});
