import { describe, expect, it } from '@jest/globals';

import { parseWholeNumberInput, wholeNumberInputText } from './numberInput';

describe('parseWholeNumberInput', () => {
  it('reads the number typed', () => {
    expect(parseWholeNumberInput('5')).toBe(5);
    expect(parseWholeNumberInput('12')).toBe(12);
  });

  it('is null once the field is cleared, so it stays empty instead of snapping back to its default', () => {
    expect(parseWholeNumberInput('')).toBeNull();
  });

  it("can't be zero: a lone zero clears the field, and leading zeros are dropped", () => {
    expect(parseWholeNumberInput('0')).toBeNull();
    expect(parseWholeNumberInput('00')).toBeNull();
    expect(parseWholeNumberInput('05')).toBe(5);
    expect(parseWholeNumberInput('10')).toBe(10);
  });

  it("can't be negative: a minus sign, thousands comma or any other non-digit is dropped", () => {
    expect(parseWholeNumberInput('-3')).toBe(3);
    expect(parseWholeNumberInput('-')).toBeNull();
    expect(parseWholeNumberInput('1,500')).toBe(1500);
    expect(parseWholeNumberInput(' 4 ')).toBe(4);
  });

  it('keeps only the whole part of a pasted decimal, never gluing the digits together', () => {
    expect(parseWholeNumberInput('1500.50')).toBe(1500);
    expect(parseWholeNumberInput('3.5')).toBe(3);
    expect(parseWholeNumberInput('0.5')).toBeNull();
  });
});

describe('wholeNumberInputText', () => {
  it('shows the number, or nothing for an empty field', () => {
    expect(wholeNumberInputText(3)).toBe('3');
    expect(wholeNumberInputText(null)).toBe('');
    expect(wholeNumberInputText(undefined)).toBe('');
  });
});
