// Phase 3 central-auth cutover — the tenant auth mode flag.
//
// `TENANT_AUTH_MODE=legacy-jwt` (default) keeps the current behaviour:
// the DualModeAuthGuard (legacy JWT first, tenant Better Auth session
// second) and the tenant-DB `better_auth_*` writes.
// `TENANT_AUTH_MODE=central-ba` switches the tenant backend to verify
// sessions against the central auth service over HTTP and to call the
// service's internal user endpoints instead of writing BA rows directly.
//
// The flag is read from the process env at each call (no caching) so a
// test can flip it per case and so a bad value fails safe to legacy.
// An unrecognised value warns once per process and behaves as legacy.
export type TenantAuthMode = 'legacy-jwt' | 'central-ba';

const VALID_MODES: readonly string[] = ['legacy-jwt', 'central-ba'];

let warnedInvalid = false;

export function getTenantAuthMode(): TenantAuthMode {
  const raw = process.env['TENANT_AUTH_MODE'];
  if (raw === undefined || raw === '') {
    return 'legacy-jwt';
  }
  if ((VALID_MODES as readonly string[]).includes(raw)) {
    return raw as TenantAuthMode;
  }
  if (!warnedInvalid) {
    warnedInvalid = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[tenant-auth-mode] Invalid TENANT_AUTH_MODE=${JSON.stringify(raw)} — falling back to 'legacy-jwt'.`,
    );
  }
  return 'legacy-jwt';
}

export function isCentralAuthMode(): boolean {
  return getTenantAuthMode() === 'central-ba';
}

/** Test-only reset for the invalid-value warning. */
export function __resetTenantAuthModeWarning(): void {
  warnedInvalid = false;
}
