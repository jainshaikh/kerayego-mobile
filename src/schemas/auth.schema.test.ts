import { describe, expect, it } from '@jest/globals';

import { phoneProfileSchema, phoneSignInSchema, signInEmailSchema } from './auth.schema';

describe('phoneSignInSchema', () => {
  it('accepts numbers as people type them', () => {
    for (const phone of ['03001234567', '+923001234567', '0300 123-4567', '(050) 123 4567', ' 0300 1234567 ']) {
      expect(phoneSignInSchema.safeParse({ phone }).success).toBe(true);
    }
  });

  it('trims the number', () => {
    expect(phoneSignInSchema.parse({ phone: ' 03001234567 ' }).phone).toBe('03001234567');
  });

  it('rejects an empty, too long or non-numeric number', () => {
    const message = (phone: string) => phoneSignInSchema.safeParse({ phone }).error?.issues[0]?.message;
    expect(message('')).toBe('Mobile number is required');
    expect(message('   ')).toBe('Mobile number is required');
    expect(message('0300123456789012345678')).toBe('Mobile number is too long');
    expect(message('call me')).toBe('Enter a valid mobile number');
    expect(message('03+001234567')).toBe('Enter a valid mobile number');
  });
});

describe('phoneProfileSchema', () => {
  it('accepts a name and an email', () => {
    expect(phoneProfileSchema.parse({ name: ' Ali Khan ', email: ' ali@example.com ' })).toEqual({
      name: 'Ali Khan',
      email: 'ali@example.com',
    });
  });

  it('requires a name of at most 100 characters', () => {
    expect(phoneProfileSchema.safeParse({ name: ' ', email: 'a@b.co' }).error?.issues[0]?.message).toBe('Name is required');
    expect(phoneProfileSchema.safeParse({ name: 'x'.repeat(101), email: 'a@b.co' }).error?.issues[0]?.message).toBe(
      'Name is too long',
    );
  });

  it('requires a valid email', () => {
    expect(phoneProfileSchema.safeParse({ name: 'Ali', email: '' }).error?.issues[0]?.message).toBe('Email is required');
    expect(phoneProfileSchema.safeParse({ name: 'Ali', email: 'ali@' }).error?.issues[0]?.message).toBe('Enter a valid email');
  });
});

describe('signInEmailSchema', () => {
  it('still checks the email backup sign-in', () => {
    expect(signInEmailSchema.safeParse({ email: 'ali@example.com' }).success).toBe(true);
    expect(signInEmailSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});
