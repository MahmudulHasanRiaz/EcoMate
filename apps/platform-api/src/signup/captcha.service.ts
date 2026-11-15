import { Injectable } from '@nestjs/common';

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
  async verify(token?: string, ip?: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return process.env.NODE_ENV !== 'production';
    if (!token) return false;

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
      if (!response.ok) return false;
      const data = (await response.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  }
}
