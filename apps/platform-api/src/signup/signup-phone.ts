/**
 * Common written forms of the same phone number. Signup is the only place a
 * phone is collected, so exact-value lookups would miss `+8801700…` vs
 * `01700…` vs `8801700…`. The variants are used only for dedupe; the owner's
 * original formatting is stored unchanged.
 */
export function phoneVariants(raw?: string | null): string[] {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return [trimmed];

  const variants = new Set<string>([trimmed, digits]);

  if (digits.startsWith('880') && digits.length >= 12) {
    const local = digits.slice(3);
    variants.add(`+${digits}`);
    variants.add(local);
    if (local.startsWith('1')) variants.add(`0${local}`);
  } else if (digits.startsWith('0')) {
    const local = digits.slice(1);
    variants.add(`+880${local}`);
    variants.add(`880${local}`);
    variants.add(local);
  } else if (digits.startsWith('1') && digits.length === 10) {
    variants.add(`0${digits}`);
    variants.add(`+880${digits}`);
    variants.add(`880${digits}`);
  } else {
    variants.add(`+${digits}`);
  }

  return [...variants];
}

/**
 * Canonical form stored on new signups/tenants. Dedupe queries still check all
 * variants so legacy rows in any common format are matched too.
 */
export function normalizePhone(raw?: string | null): string | null {
  const variants = phoneVariants(raw);
  if (variants.length === 0) return null;
  const international = variants.find((value) => /^\+\d{7,}$/.test(value));
  if (international) return international;
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}
