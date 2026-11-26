/**
 * Shared Better Auth error + social helpers (Phase 3 tenant cutover).
 *
 * The BA client returns `{ data, error }` (it does not throw on a 4xx);
 * the error shape varies by call site, so every reader goes through these
 * helpers instead of reaching into one assumed shape.
 */

export type BaClientError = {
  status?: number
  statusText?: string
  code?: string
  message?: string
  body?: { code?: string; message?: string; status?: number } | string | null
} | null | undefined

/** Error code, wherever the client put it (`code` or `body.code`). */
export function getBaErrorCode(error: BaClientError): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if (typeof error.code === 'string' && error.code) return error.code
  const body = error.body
  if (body && typeof body === 'object' && typeof body.code === 'string') {
    return body.code
  }
  return undefined
}

/** Human-readable message, with a fallback when the server sent none. */
export function baErrorMessage(error: BaClientError, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback
  const body = error.body
  if (body && typeof body === 'object') {
    const message = body.message
    if (typeof message === 'string' && message) return message
  }
  if (typeof error.message === 'string' && error.message) return error.message
  if (error.status) return `${fallback} (error ${error.status})`
  return fallback
}

/**
 * Phase 1 Q11: after a password sign-in, a TOTP-enabled user gets
 * FORBIDDEN { code: "TWO_FACTOR_REQUIRED" } and NO session cookie.
 * The login screen must show the challenge instead of a generic error.
 */
export function isTwoFactorRequiredError(error: BaClientError): boolean {
  return getBaErrorCode(error) === 'TWO_FACTOR_REQUIRED'
}

/** Social providers wired to the central service (D9=B). */
export const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
  { id: 'facebook', label: 'Facebook' },
] as const

export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number]['id']

/**
 * Callback URLs for social sign-in.
 *
 * `callbackURL` is where the central service sends the user after the
 * provider approves; `errorCallbackURL` is where it sends them when the
 * provider (or the user) refuses — the account page reads `?error=` there
 * and shows an inline banner instead of a dead end.
 *
 * Fixed-host-set constraint (Phase 1 D9): providers forbid wildcard
 * redirect URIs, so social works only on the fixed host set the service
 * was configured with. Per-tenant-subdomain callbacks are not
 * registerable — on a custom domain the provider will refuse, and the
 * user falls back to email sign-in.
 */
export function socialCallbackUrls(): {
  callbackURL: string
  errorCallbackURL: string
} {
  const origin = window.location.origin
  return {
    callbackURL: `${origin}/account`,
    errorCallbackURL: `${origin}/account`,
  }
}
