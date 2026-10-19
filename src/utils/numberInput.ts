/**
 * What a whole-number form field holds for the text typed (or pasted) into
 * it: the whole part only — anything from a decimal point on is cut, and a
 * minus sign or any other non-digit (a thousands comma, a space) dropped, so
 * zero and negative values can't be entered — and null once the field is
 * empty (or holds only zeros). Null, never undefined: React Hook Form puts a
 * field's default value back when it's set to undefined, which made a field
 * with a default impossible to clear.
 */
export function parseWholeNumberInput(text: string): number | null {
  const digits = text.split('.')[0].replace(/\D/g, '').replace(/^0+/, '');
  return digits ? Number(digits) : null;
}

/** A whole-number field's value as its input's text — empty for null/undefined. */
export function wholeNumberInputText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}
