// Pakistani CNIC number: 13 digits, written 12345-1234567-1.
//
// CNIC_PATTERN is copied from the backend (kerayego-backend
// src/modules/users/cnic-hash.service.ts) — dashes optional — so the form
// accepts exactly what the backend's DTOs accept.
export const CNIC_PATTERN = /^\d{5}-?\d{7}-?\d$/;

const CNIC_DIGITS = 13;

/**
 * Formats what the person has typed so far as 12345-1234567-1: keeps the
 * digits only (at most 13) and puts the dashes in once the digits reach them.
 * Never adds a trailing dash, so backspacing over one just works.
 */
export function formatCnicInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, CNIC_DIGITS);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/** True for a complete CNIC number the backend accepts (CNIC_PATTERN). */
export function isValidCnic(value: string): boolean {
  return CNIC_PATTERN.test(value.trim());
}
