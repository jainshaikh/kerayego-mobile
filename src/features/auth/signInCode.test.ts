import { describe, expect, it, jest } from '@jest/globals';

import {
  DEFAULT_RESEND_AFTER_SECONDS,
  isCompleteCode,
  normalizeCodeInput,
  resendAvailableAt,
  resendAvailableFromNow,
  resendDelaySeconds,
  resendLabel,
  resendSecondsLeft,
  signUpErrorField,
} from './signInCode';

describe('normalizeCodeInput', () => {
  it('keeps digits only, at most 6', () => {
    expect(normalizeCodeInput('123456')).toBe('123456');
    expect(normalizeCodeInput('123 456')).toBe('123456');
    expect(normalizeCodeInput('Code: 123-456')).toBe('123456');
    expect(normalizeCodeInput('1234567')).toBe('123456');
    expect(normalizeCodeInput('abc')).toBe('');
    expect(normalizeCodeInput('')).toBe('');
  });
});

describe('isCompleteCode', () => {
  it('is true for exactly 6 digits only', () => {
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('000000')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('1234567')).toBe(false);
    expect(isCompleteCode('12345a')).toBe(false);
    expect(isCompleteCode('123 456')).toBe(false);
    expect(isCompleteCode('')).toBe(false);
  });
});

describe('resend countdown', () => {
  const SENT = 1_000_000;

  it('uses the server delay when it is a sane number, else 60 s', () => {
    expect(resendDelaySeconds(60)).toBe(60);
    expect(resendDelaySeconds(30.2)).toBe(31);
    expect(resendDelaySeconds(0)).toBe(0);
    expect(resendDelaySeconds(undefined)).toBe(DEFAULT_RESEND_AFTER_SECONDS);
    expect(resendDelaySeconds(-5)).toBe(DEFAULT_RESEND_AFTER_SECONDS);
    expect(resendDelaySeconds('60')).toBe(DEFAULT_RESEND_AFTER_SECONDS);
    expect(resendDelaySeconds(Number.NaN)).toBe(DEFAULT_RESEND_AFTER_SECONDS);
  });

  it('counts down whole seconds and stops at 0', () => {
    const at = resendAvailableAt(SENT, 60);
    expect(at).toBe(SENT + 60_000);
    expect(resendSecondsLeft(at, SENT)).toBe(60);
    expect(resendSecondsLeft(at, SENT + 500)).toBe(60);
    expect(resendSecondsLeft(at, SENT + 1_000)).toBe(59);
    expect(resendSecondsLeft(at, SENT + 59_001)).toBe(1);
    expect(resendSecondsLeft(at, SENT + 60_000)).toBe(0);
    expect(resendSecondsLeft(at, SENT + 120_000)).toBe(0);
  });

  it('starts the countdown from the moment the code was sent', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(SENT);
    try {
      expect(resendAvailableFromNow(60)).toBe(SENT + 60_000);
      expect(resendAvailableFromNow(-1)).toBe(SENT);
    } finally {
      spy.mockRestore();
    }
  });

  it('labels the button with the seconds left', () => {
    expect(resendLabel(42)).toBe('Send again in 42s');
    expect(resendLabel(0)).toBe('Send again');
  });
});

describe('signUpErrorField', () => {
  it('puts PHONE_TAKEN under the phone field', () => {
    expect(
      signUpErrorField({
        kind: 'conflict',
        code: 'PHONE_TAKEN',
        message: "This mobile number is already used by another KerayeGo account. If it's yours, contact KerayeGo support.",
      }),
    ).toBe('phone');
  });

  it('puts an invalid mobile number under the phone field', () => {
    expect(
      signUpErrorField({
        kind: 'validation',
        code: 'BAD_REQUEST',
        message: 'Enter a valid mobile number, e.g. 03001234567 or +923001234567',
      }),
    ).toBe('phone');
  });

  it('puts an existing email under the email field', () => {
    expect(
      signUpErrorField({ kind: 'conflict', code: 'CONFLICT', message: 'An account with this email already exists' }),
    ).toBe('email');
  });

  it('shows everything else on the form', () => {
    expect(
      signUpErrorField({
        kind: 'unauthorized',
        code: 'CODE_INVALID',
        message: 'That code is wrong or has expired. Ask for a new one.',
      }),
    ).toBe('form');
    expect(signUpErrorField({ kind: 'network', message: 'No connection.' })).toBe('form');
    expect(signUpErrorField({ kind: 'validation', code: 'BAD_REQUEST', message: 'Validation failed' })).toBe('form');
    expect(signUpErrorField({ kind: 'forbidden', code: 'IDENTITY_BLOCKED', message: 'Blocked' })).toBe('form');
  });
});
