// Phase 4 central-auth cutover — the console auth-mode flag.
//
// `CONSOLE_AUTH_MODE=custom-jwt` (default) keeps the current behaviour:
// the legacy JWT guards + `AuthService` login/refresh + TOTP MFA.
// `CONSOLE_AUTH_MODE=central-ba` switches platform-api to verify sessions
// against the central auth service over HTTP (Better Auth) and to call
// the service's internal user endpoints instead of the local JWT
// machinery. Legacy code stays behind the flag until Phase 5.
//
// The flag is read from the process env at each call (no caching) so a
// test can flip it per case and so a bad value fails safe to legacy.
// Mirrors the backend's `getTenantAuthMode` (TENANT_AUTH_MODE).
export type ConsoleAuthMode = 'custom-jwt' | 'central-ba';

const VALID_MODES: readonly string[] = ['custom-jwt', 'central-ba'];

let warnedInvalid = false;

export function getConsoleAuthMode(): ConsoleAuthMode {
  const raw = process.env['CONSOLE_AUTH_MODE'];
  if (raw === undefined || raw === '') {
    return 'custom-jwt';
  }
  if ((VALID_MODES as readonly string[]).includes(raw)) {
    return raw as ConsoleAuthMode;
  }
  if (!warnedInvalid) {
    warnedInvalid = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[console-auth-mode] Invalid CONSOLE_AUTH_MODE=${JSON.stringify(raw)} — falling back to 'custom-jwt'.`,
    );
  }
  return 'custom-jwt';
}

export function isCentralAuthMode(): boolean {
  return getConsoleAuthMode() === 'central-ba';
}

/** Test-only reset for the invalid-value warning. */
export function __resetConsoleAuthModeWarning(): void {
  warnedInvalid = false;
}
