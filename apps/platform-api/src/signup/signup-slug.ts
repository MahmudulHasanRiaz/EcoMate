import { RESERVED_SLUGS } from '../config/domain-config.service';

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export function normaliseSlug(input: string): string {
  return String(input || '').trim().toLowerCase();
}

/**
 * Validate a tenant slug: 3–30 chars, lowercase letters/numbers/hyphens, no
 * leading/trailing hyphen, and never a platform-reserved slug (checked across
 * the platform's reserved list — the same list used by host resolution).
 */
export function validateSlug(raw: string): { ok: true; slug: string } | { ok: false; message: string } {
  const slug = normaliseSlug(raw);
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      message:
        'Slug must be 3–30 characters: lowercase letters, numbers or hyphens, starting and ending with a letter or number.',
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, message: 'This slug is reserved' };
  }
  return { ok: true, slug };
}
