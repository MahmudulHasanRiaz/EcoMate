import { describe, expect, it } from 'vitest';
import {
  getBranding,
  isSafeLogoUrl,
  tenantAdminSignInUrl,
} from '../branding';

describe('getBranding', () => {
  it('defaults to the EcoMate text mark', () => {
    expect(getBranding({})).toEqual({ platformName: 'EcoMate', logoUrl: '' });
  });

  it('reads platform name and logo URL from env', () => {
    expect(
      getBranding({
        NEXT_PUBLIC_PLATFORM_NAME: 'Acme Commerce',
        NEXT_PUBLIC_LOGO_URL: 'https://cdn.example.com/logo.png',
      }),
    ).toEqual({
      platformName: 'Acme Commerce',
      logoUrl: 'https://cdn.example.com/logo.png',
    });
  });

  it('drops an unsafe logo URL instead of rendering it', () => {
    expect(
      getBranding({ NEXT_PUBLIC_LOGO_URL: 'javascript:alert(1)' }).logoUrl,
    ).toBe('');
    expect(
      getBranding({ NEXT_PUBLIC_LOGO_URL: 'http://cdn.example.com/l.png' })
        .logoUrl,
    ).toBe('');
  });
});

describe('isSafeLogoUrl', () => {
  it('accepts https URLs and same-origin paths', () => {
    expect(isSafeLogoUrl('https://cdn.example.com/logo.png')).toBe(true);
    expect(isSafeLogoUrl('/logo.png')).toBe(true);
  });

  it('rejects javascript:, data:, http: and protocol-relative URLs', () => {
    expect(isSafeLogoUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeLogoUrl('data:image/svg+xml,<svg/>')).toBe(false);
    expect(isSafeLogoUrl('http://cdn.example.com/l.png')).toBe(false);
    expect(isSafeLogoUrl('//cdn.example.com/l.png')).toBe(false);
    expect(isSafeLogoUrl('')).toBe(false);
  });
});

describe('tenantAdminSignInUrl', () => {
  it('builds the tenant admin sign-in URL', () => {
    expect(tenantAdminSignInUrl('acme-store')).toBe(
      'https://acme-store.ecomate.bd/admin/sign-in',
    );
  });

  it('honours NEXT_PUBLIC_PRIMARY_DOMAIN', () => {
    expect(
      tenantAdminSignInUrl('acme', {
        NEXT_PUBLIC_PRIMARY_DOMAIN: 'staging.ecomate.bd',
      }),
    ).toBe('https://acme.staging.ecomate.bd/admin/sign-in');
  });

  it('rejects invalid slugs instead of building a bad URL', () => {
    expect(tenantAdminSignInUrl('ab')).toBe(null);
    expect(tenantAdminSignInUrl('-acme')).toBe(null);
    expect(tenantAdminSignInUrl('ACME STORE')).toBe(null);
    expect(tenantAdminSignInUrl('')).toBe(null);
  });

  it('normalises case and whitespace', () => {
    expect(tenantAdminSignInUrl('  Acme-Store ')).toBe(
      'https://acme-store.ecomate.bd/admin/sign-in',
    );
  });
});
