import { describe, expect, it } from 'vitest';
import nextConfig, {
  LANDING_CSP,
  LANDING_SECURITY_HEADERS,
} from '../../next.config';

describe('landing security headers', () => {
  it('serves an enforcing CSP (not Report-Only)', async () => {
    const headers = await nextConfig.headers!();
    const global = headers.find((h) => h.source === '/:path*');
    expect(global).toBeDefined();
    const csp = global!.headers.find(
      (h) => h.key === 'Content-Security-Policy',
    );
    expect(csp).toBeDefined();
    expect(csp!.value).toBe(LANDING_CSP);
    expect(
      global!.headers.some((h) => h.key === 'Content-Security-Policy-Report-Only'),
    ).toBe(false);
  });

  it('allows Turnstile and nothing else third-party', () => {
    expect(LANDING_CSP).toContain('https://challenges.cloudflare.com');
    // No other https: origin is allowlisted anywhere in the policy.
    const origins = LANDING_CSP.match(/https:\/\/[a-z0-9.-]+/g) ?? [];
    expect([...new Set(origins)]).toEqual(['https://challenges.cloudflare.com']);
  });

  it('blocks framing, sniffing, plugins and object embeds', () => {
    expect(LANDING_CSP).toContain("object-src 'none'");
    expect(LANDING_CSP).toContain("base-uri 'self'");
    expect(LANDING_CSP).toContain("form-action 'self'");
    const byKey = new Map(
      LANDING_SECURITY_HEADERS.map((h) => [h.key, h.value]),
    );
    expect(byKey.get('X-Frame-Options')).toBe('DENY');
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(byKey.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });
});
