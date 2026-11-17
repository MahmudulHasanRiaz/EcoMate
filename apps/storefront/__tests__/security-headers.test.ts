import { describe, it, expect } from 'vitest';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import nextConfigFactory from '../next.config';

describe('storefront security headers (next.config)', () => {
  it('serves an ENFORCING Content-Security-Policy on every route', async () => {
    const config = await nextConfigFactory(PHASE_PRODUCTION_BUILD);
    const headers = await config.headers!();
    const global = headers.find((h) => h.source === '/:path*');
    expect(global).toBeDefined();
    const csp = global!.headers.find(
      (h) => h.key === 'Content-Security-Policy',
    );
    expect(csp).toBeDefined();
    // The policy must not be Report-Only anywhere.
    expect(
      headers.some((h) =>
        h.headers.some(
          (x) => x.key === 'Content-Security-Policy-Report-Only',
        ),
      ),
    ).toBe(false);
  });

  it('keeps the tracking origins and the report endpoint in the policy', async () => {
    const config = await nextConfigFactory(PHASE_PRODUCTION_BUILD);
    const headers = await config.headers!();
    const global = headers.find((h) => h.source === '/:path*')!;
    const csp = global.headers.find(
      (h) => h.key === 'Content-Security-Policy',
    )!.value;
    for (const origin of [
      'https://connect.facebook.net',
      'https://www.googletagmanager.com',
      'https://analytics.tiktok.com',
      'https://static.cloudflareinsights.com',
    ]) {
      expect(csp).toContain(origin);
    }
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('keeps the other hardening headers alongside the CSP', async () => {
    const config = await nextConfigFactory(PHASE_PRODUCTION_BUILD);
    const headers = await config.headers!();
    const global = headers.find((h) => h.source === '/:path*')!;
    const byKey = new Map(global.headers.map((h) => [h.key, h.value]));
    expect(byKey.get('X-Frame-Options')).toBe('DENY');
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey.get('Strict-Transport-Security')).toContain(
      'max-age=63072000',
    );
  });
});
