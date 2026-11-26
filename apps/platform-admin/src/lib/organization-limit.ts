/**
 * Organization-limit input rules (D12).
 *
 * Console UI range is 1–100 (survey §10 Q9); the platform API clamps
 * server-side to [1, 1000] and rejects non-integers. The console
 * validates 1–100 so an out-of-range value is a visible error, never a
 * silent clamp.
 */

export const ORGANIZATION_LIMIT_MIN = 1;
export const ORGANIZATION_LIMIT_MAX = 100;
export const ORGANIZATION_LIMIT_DEFAULT = 5;

export type OrganizationLimitParse =
  | { ok: true; limit: number }
  | { ok: false; error: string };

export function parseOrganizationLimitInput(
  value: string,
): OrganizationLimitParse {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      error: 'Enter a whole number of organizations per user.',
    };
  }
  const limit = Number(trimmed);
  if (limit < ORGANIZATION_LIMIT_MIN || limit > ORGANIZATION_LIMIT_MAX) {
    return {
      ok: false,
      error: `Enter a number between ${ORGANIZATION_LIMIT_MIN} and ${ORGANIZATION_LIMIT_MAX}.`,
    };
  }
  return { ok: true, limit };
}
