import { describe, expect, it } from '@jest/globals';

import { CNIC_PATTERN, formatCnicInput, isValidCnic } from './cnic';

describe('formatCnicInput', () => {
  it.each<[string, string]>([
    ['', ''],
    ['3', '3'],
    ['35202', '35202'],
    ['352021', '35202-1'],
    ['352021234567', '35202-1234567'],
    ['3520212345671', '35202-1234567-1'],
  ])('formats %p as %p while typing', (raw, formatted) => {
    expect(formatCnicInput(raw)).toBe(formatted);
  });

  it('keeps an already formatted number as it is', () => {
    expect(formatCnicInput('35202-1234567-1')).toBe('35202-1234567-1');
  });

  it('drops anything that is not a digit (spaces, letters, stray dashes)', () => {
    expect(formatCnicInput(' 35202 12-34567a1 ')).toBe('35202-1234567-1');
  });

  it('stops at 13 digits', () => {
    expect(formatCnicInput('35202123456719999')).toBe('35202-1234567-1');
  });

  it('never ends with a dash, so backspacing over one removes it', () => {
    // "35202-1" with the 1 deleted arrives as "35202-".
    expect(formatCnicInput('35202-')).toBe('35202');
    expect(formatCnicInput('35202-1234567-')).toBe('35202-1234567');
  });
});

describe('isValidCnic', () => {
  it('accepts 13 digits with or without the dashes (the backend pattern)', () => {
    expect(isValidCnic('35202-1234567-1')).toBe(true);
    expect(isValidCnic('3520212345671')).toBe(true);
    expect(isValidCnic(' 35202-1234567-1 ')).toBe(true);
  });

  it.each(['', '35202', '35202-1234567', '35202-123456-71', '35202-1234567-12', 'abcde-fghijkl-m'])(
    'rejects %p',
    (value) => {
      expect(isValidCnic(value)).toBe(false);
    },
  );

  it('accepts every complete number formatCnicInput produces', () => {
    expect(CNIC_PATTERN.test(formatCnicInput('3520212345671'))).toBe(true);
  });
});
