import { Injectable } from '@nestjs/common';

/**
 * Discriminated Turnstile result. The distinction matters to callers:
 * - `not_configured`: no TURNSTILE_SECRET_KEY in production — the server
 *   cannot verify anyone, so signup must say so honestly (503 +
 *   `captcha_not_configured`) instead of blaming the user for failing a
 *   challenge that never appeared.
 * - `failed`: the token was missing/invalid or Turnstile rejected it —
 *   the user-facing challenge-failed message still applies.
 */
export type CaptchaResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'failed' };

/**
 * Cloudflare Turnstile verification for public signup.
 *
 * Configure TURNSTILE_SECRET_KEY in production; the landing page renders the
 * widget when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. Without a secret,
 * production signup fails closed (the token can never be verified), while
 * dev/test keeps the flow usable.
 */
@Injectable()
export class CaptchaService {
  /** True when a Turnstile secret is configured (production verification). */
  isConfigured(): boolean {
    return !!process.env.TURNSTILE_SECRET_KEY;
  }

  async verify(token?: string, ip?: string): Promise<CaptchaResult> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      // No secret: dev/test keeps the flow usable; production fails
      // closed — but says so explicitly (not_configured) instead of
      // blaming the user for a challenge that never appeared.
      return process.env.NODE_ENV !== 'production'
        ? { ok: true }
        : { ok: false, reason: 'not_configured' };
    }
    if (!token) return { ok: false, reason: 'failed' };

    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);

    try {
      const response = await fetch(
        process.env.TURNSTILE_VERIFY_URL ||
          'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) return { ok: false, reason: 'failed' };
      const data = (await response.json()) as { success?: boolean };
      return data.success === true
        ? { ok: true }
        : { ok: false, reason: 'failed' };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }
}
