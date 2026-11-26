// Organization-limit setting (D12: max organizations per user).
//
// The console settings UI for this value lands in a later phase
// (Phase 4, per the Phase 1 report §8 item 2) — until then the limit is
// the `organization_limit` PlatformSetting row, written directly (seed /
// operator), with the D12 default of 5 when the row is absent or
// malformed. This module is the single reader: the auth service fetches
// GET /internal/settings/organization-limit (60 s cache, env fallback)
// and reads the `limit` field; the future console UI edits the same row
// through SettingsService, so no second settings mechanism is invented
// here.
//
// Stored shape: `{ "limit": <number> }` (a bare JSON number is also
// accepted for operator convenience). The value is clamped to
// [1, 1000] — a 0/negative setting must never block all org creation
// (same clamp as the auth service's `clampOrgLimit`).

export const ORGANIZATION_LIMIT_SETTING_KEY = 'organization_limit';
export const DEFAULT_ORGANIZATION_LIMIT = 5;
export const ORGANIZATION_LIMIT_MIN = 1;
export const ORGANIZATION_LIMIT_MAX = 1000;

export function clampOrganizationLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ORGANIZATION_LIMIT;
  return Math.min(
    ORGANIZATION_LIMIT_MAX,
    Math.max(ORGANIZATION_LIMIT_MIN, Math.trunc(value)),
  );
}

export function parseOrganizationLimitSetting(value: unknown): {
  limit: number;
  source: 'setting' | 'default';
} {
  let raw: unknown;
  if (typeof value === 'number') {
    raw = value;
  } else if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'limit' in value
  ) {
    raw = (value as Record<string, unknown>)['limit'];
  }
  const n =
    typeof raw === 'number'
      ? raw
      : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) {
    return { limit: DEFAULT_ORGANIZATION_LIMIT, source: 'default' };
  }
  return { limit: clampOrganizationLimit(n), source: 'setting' };
}
