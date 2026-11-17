/**
 * Human-verification availability for public signup.
 *
 * The signup wizard can only work when the Turnstile site key is baked
 * into the landing build (so a challenge can render) and the platform
 * verifies tokens server-side. The platform fails closed in production
 * without TURNSTILE_SECRET_KEY (verification rejects), while in
 * non-production it skips verification entirely — so the wizard mirrors
 * that rule exactly: in production without a site key, signup is
 * honestly unavailable instead of letting users fill all 3 steps and
 * then failing them with a bogus "complete the challenge" error for a
 * challenge that never appeared (Boss-confirmed live, 2026-11-17).
 *
 * The env record is a parameter (never a bare `process.env` default):
 * the wizard is a client component, where only direct
 * `process.env.NEXT_PUBLIC_*` / `process.env.NODE_ENV` member accesses
 * are inlined at build time.
 */

export const CAPTCHA_NOT_CONFIGURED_CODE = 'captcha_not_configured';

export const SIGNUP_UNAVAILABLE_HEADING = 'Signup is temporarily unavailable';

export const SIGNUP_UNAVAILABLE_BODY =
  'We are unable to verify new signups at the moment — the check that keeps fake accounts out is not set up on our side yet. Please try again later.';

export const RESEND_UNAVAILABLE_MESSAGE =
  'We cannot send the email right now because verification is not set up on our side. Please try again later.';

/**
 * True when the wizard may accept signups: always in non-production
 * (the platform skips verification there), in production only when a
 * Turnstile site key is configured.
 */
export function isSignupVerificationAvailable(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return Boolean((env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim());
}

/**
 * True when a server error body is the platform's distinct
 * not-configured error (HTTP 503 with code `captcha_not_configured`),
 * as opposed to a genuine challenge failure.
 */
export function isCaptchaNotConfiguredError(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  return (
    (data as { code?: unknown }).code === CAPTCHA_NOT_CONFIGURED_CODE
  );
}
