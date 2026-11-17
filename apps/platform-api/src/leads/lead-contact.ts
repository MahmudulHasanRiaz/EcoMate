import { isEmail } from 'class-validator';

/**
 * Lead contact classification. The landing lead form takes ONE contact
 * field — an email address OR a phone number — and the API stores which
 * kind it is so the console (and the sales notification) can label it.
 *
 * Email: class-validator's isEmail (same check as signup's ownerEmail).
 * Phone: 7–15 digits, optional leading `+`, after stripping the
 * separators people type (spaces, dashes, parentheses, dots). Accepts
 * +8801… / 01… / 8801… and other international formats; deliberately
 * loose — a lead is a low-privilege record and rejecting a real number
 * costs more than accepting a sloppy one.
 */
export type LeadContactTypeValue = 'email' | 'phone';

export function classifyContact(
  raw?: string | null,
): LeadContactTypeValue | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.length > 254) return null;
  if (isEmail(value)) return 'email';

  const compact = value.replace(/[\s\-().]/g, '');
  if (/^\+?\d{7,15}$/.test(compact)) return 'phone';
  return null;
}
