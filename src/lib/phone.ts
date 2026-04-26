export type NormalizedPhoneResult = {
  value: string;
  isValid: boolean;
  last11: string;
};

/** Returns true if the input contains any Bangla digit (০-৯). */
export function hasBanglaDigits(input: string): boolean {
  return /[\u09E6-\u09EF]/.test(input);
}

export function stripToDigits(input: string | null | undefined): string {
  if (!input) return '';
  return String(input).replace(/\D/g, '');
}

/**
 * Storage rule (BD-focused):
 * - Remove all special characters (digits only)
 * - If cleaned digits length >= 11: take last 11 digits
 *   - If that 11-digit number starts with 0 -> valid -> store that last 11
 *   - Otherwise -> invalid -> store the full cleaned digits (so admin can see/fix)
 * - If length < 11 -> invalid -> store the cleaned digits
 */
export function normalizeBdPhoneForStorage(input: string | null | undefined): NormalizedPhoneResult {
  const digits = stripToDigits(input);

  if (digits.length < 11) {
    return { value: digits, isValid: false, last11: digits };
  }

  const last11 = digits.slice(-11);
  const isValid = last11.length === 11 && last11.startsWith('0');
  return {
    value: isValid ? last11 : digits,
    isValid,
    last11,
  };
}

export function isValidBdPhone(input: string | null | undefined): boolean {
  const normalized = normalizeBdPhoneForStorage(input);
  return normalized.isValid;
}

export function getValidBdPhone11(input: string | null | undefined): string | null {
  const normalized = normalizeBdPhoneForStorage(input);
  return normalized.isValid ? normalized.last11 : null;
}

/**
 * Returns `8801XXXXXXXXX` (no `+`) when valid; otherwise `null`.
 */
export function formatBdPhoneWithCountryCode(input: string | null | undefined): string | null {
  const phone11 = getValidBdPhone11(input);
  if (!phone11) return null;
  return `88${phone11}`;
}

export function formatTelHref(input: string | null | undefined): string | null {
  const cc = formatBdPhoneWithCountryCode(input);
  if (!cc) return null;
  return `tel:+${cc}`;
}

export function formatWhatsAppHref(input: string | null | undefined, message?: string): string | null {
  const cc = formatBdPhoneWithCountryCode(input);
  if (!cc) return null;
  const base = `https://wa.me/${cc}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}

/**
 * For missing/empty phones we still need a unique string in DB.
 * Generates an 11-digit number that never starts with 0 (so it's always invalid).
 */
export function generateInvalidPhonePlaceholder(nowMs: number = Date.now()): string {
  const timePart = String(nowMs).slice(-9).padStart(9, '0');
  const rand = Math.floor(Math.random() * 10);
  return `1${timePart}${rand}`;
}

