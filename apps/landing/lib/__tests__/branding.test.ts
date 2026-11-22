import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchBranding,
  getBranding,
  isSafeLogoUrl,
  tenantAdminSignInUrl,
} from '../branding';

describe('getBranding', () => {
  it('defaults to the EcoMate text mark', () => {
    expect(getBranding({})).toEqual({
      platformName: 'EcoMate',
      logoUrl: '',
      faviconUrl: '',
    });
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
      faviconUrl: '',
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

describe('fetchBranding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the managed branding on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          platformName: 'Managed Name',
          logoUrl: 'https://cdn.example.com/logo.png',
          faviconUrl: 'https://cdn.example.com/favicon.png',
        }),
      }),
    );
    await expect(fetchBranding()).resolves.toEqual({
      platformName: 'Managed Name',
      logoUrl: 'https://cdn.example.com/logo.png',
      faviconUrl: 'https://cdn.example.com/favicon.png',
    });
  });

  it('accepts a data:image favicon (console upload)', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          platformName: 'EcoMate',
          logoUrl: '',
          faviconUrl: dataUrl,
        }),
      }),
    );
    await expect(fetchBranding()).resolves.toMatchObject({
      faviconUrl: dataUrl,
    });
  });

  it('falls back to env when the API is down or malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(fetchBranding()).resolves.toEqual({
      platformName: 'EcoMate',
      logoUrl: '',
      faviconUrl: '',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => 'nope' }),
    );
    await expect(fetchBranding()).resolves.toEqual({
      platformName: 'EcoMate',
      logoUrl: '',
      faviconUrl: '',
    });
  });

  it('drops an unsafe managed URL instead of rendering it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          platformName: 'EcoMate',
          logoUrl: 'javascript:alert(1)',
          faviconUrl: 'http://cdn.example.com/f.png',
        }),
      }),
    );
    await expect(fetchBranding()).resolves.toEqual({
      platformName: 'EcoMate',
      logoUrl: '',
      faviconUrl: '',
    });
  });
});

describe('isSafeLogoUrl', () => {
  it('accepts https URLs and same-origin paths', () => {
    expect(isSafeLogoUrl('https://cdn.example.com/logo.png')).toBe(true);
    expect(isSafeLogoUrl('/logo.png')).toBe(true);
  });

  it('accepts base64 data:image URLs (console uploads)', () => {
    expect(isSafeLogoUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeLogoUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(true);
  });

  it('rejects javascript:, non-base64 data:, http: and protocol-relative URLs', () => {
    expect(isSafeLogoUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeLogoUrl('data:image/svg+xml,<svg/>')).toBe(false);
    expect(isSafeLogoUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
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

  it('prefers an explicit tenant domain over the env fallback', () => {
    expect(
      tenantAdminSignInUrl(
        'acme',
        { NEXT_PUBLIC_PRIMARY_DOMAIN: 'staging.ecomate.bd' },
        'tenants.example',
      ),
    ).toBe('https://acme.tenants.example/admin/sign-in');
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
