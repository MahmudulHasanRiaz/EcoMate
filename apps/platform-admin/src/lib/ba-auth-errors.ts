/**
 * Better Auth client error helpers (Phase 4 console cutover).
 *
 * Mirrors `apps/admin/src/lib/ba-auth-errors.ts` (Phase 3): the BA client
 * returns `{ data, error }` and does not throw on a 4xx, and the error
 * shape varies by call site, so every reader goes through these helpers
 * instead of reaching into one assumed shape.
 */

export type BaClientError = {
  status?: number;
  statusText?: string;
  code?: string;
  message?: string;
  body?: { code?: string; message?: string; status?: number } | string | null;
} | null | undefined;

/** Error code, wherever the client put it (`code` or `body.code`). */
export function getBaErrorCode(error: BaClientError): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if (typeof error.code === 'string' && error.code) return error.code;
  const body = error.body;
  if (body && typeof body === 'object' && typeof body.code === 'string') {
    return body.code;
  }
  return undefined;
}

/** Human-readable message, with a fallback when the server sent none. */
export function baErrorMessage(error: BaClientError, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const body = error.body;
  if (body && typeof body === 'object' && typeof body.message === 'string' && body.message) {
    return body.message;
  }
  if (typeof error.message === 'string' && error.message) return error.message;
  if (error.status) return `${fallback} (error ${error.status})`;
  return fallback;
}

/**
 * The TOTP challenge signal. BA 1.7.28's twoFactor plugin answers a
 * credential sign-in for a TOTP-enabled user with
 * `{ twoFactorRedirect: true }` (200, `dist/plugins/two-factor/index.mjs`
 * after-hook); the auth service's own session hook throws FORBIDDEN
 * `{ code: 'TWO_FACTOR_REQUIRED' }` on the social-callback path
 * (`apps/auth-service/src/auth-options.ts`). Both shapes mean "show the
 * code step", so the console treats either as the challenge.
 */
export function isTwoFactorRequiredError(error: BaClientError): boolean {
  return getBaErrorCode(error) === 'TWO_FACTOR_REQUIRED';
}
