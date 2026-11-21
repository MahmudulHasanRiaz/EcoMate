import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearHostResolutionCache, proxy } from '../proxy';

const originalEnv = { ...process.env };
const fetchMock = vi.fn();

function request(host: string, path: string) {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host },
  });
}

function resolveResponse(body: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('storefront proxy storefront-feature gate', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    // NODE_ENV is a read-only property in the Next.js types; write
    // through a plain record view instead.
    (process.env as Record<string, string | undefined>).NODE_ENV =
      'production';
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    delete process.env.SAAS_FALLBACK_DOMAIN;
    delete process.env.SAAS_ALLOW_EXTERNAL_FALLBACK;
    clearHostResolutionCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the clean disabled page for a tenant without the storefront feature', async () => {
    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        storefrontEnabled: false,
      }),
    );

    const res = await proxy(request('shop.example.com', '/products/x'));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(text).toContain('not enabled');
    expect(text).toContain('acme');
  });

  it('serves normally when the tenant has the storefront feature', async () => {
    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        storefrontEnabled: true,
      }),
    );

    const res = await proxy(request('shop.example.com', '/products/x'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBeNull();
    // The resolved tenant id travels as a REQUEST header on the rewrite
    // (not a response header), so normal serving + no noindex is the
    // assertion — the disabled page would carry both markers.
    expect(res.headers.get('cache-control')).not.toBe('no-store');
  });

  it('fails open when the backend predates storefrontEnabled (field absent)', async () => {
    fetchMock.mockResolvedValue(
      resolveResponse({ tenantId: 'tenant-acme', slug: 'acme' }),
    );

    const res = await proxy(request('shop.example.com', '/products/x'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBeNull();
  });

  it('gates base-domain hosts too when the registry says disabled', async () => {
    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        storefrontEnabled: false,
      }),
    );

    const res = await proxy(request('acme.ecomate.bd', '/'));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('not enabled');
  });

  it('fails open when the registry cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await proxy(request('acme.ecomate.bd', '/products/x'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBeNull();
  });

  it('keeps /api answering for a disabled tenant (exempt path)', async () => {
    const res = await proxy(request('shop.example.com', '/api/products'));

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-checks a disabled verdict after the short TTL, but caches an enabled one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));

    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        storefrontEnabled: false,
      }),
    );
    await proxy(request('shop.example.com', '/'));
    await proxy(request('shop.example.com', '/'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 16s later the disabled verdict has expired — the next request
    // re-asks the registry, so a freshly paid storefront appears fast.
    vi.setSystemTime(new Date('2026-11-21T12:00:16.000Z'));
    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        storefrontEnabled: true,
      }),
    );
    const res = await proxy(request('shop.example.com', '/'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.headers.get('x-robots-tag')).toBeNull();

    // The enabled verdict is cached for the full 60s.
    vi.setSystemTime(new Date('2026-11-21T12:00:46.000Z'));
    await proxy(request('shop.example.com', '/'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
