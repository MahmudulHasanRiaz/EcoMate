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

/**
 * The backend verdict (which follows the PLATFORM domain config) drives
 * alias canonicalisation even when the storefront's env config is stale
 * — e.g. after a console tenant-domain change, before redeploy.
 */
describe('storefront proxy authoritative-verdict redirect', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
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
  });

  it('301s a host the backend says is an alias, even when local env thinks it is canonical', async () => {
    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        canonicalHost: 'acme.tenants.example',
        effectiveCanonicalHost: 'acme.tenants.example',
        isAlias: true,
        storefrontEnabled: true,
      }),
    );

    const res = await proxy(request('acme.ecomate.bd', '/products/x?page=2'));

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://acme.tenants.example/products/x?page=2',
    );
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('never appends the internal container port (:3000) to a production verdict redirect', async () => {
    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        canonicalHost: 'acme.tenants.example',
        effectiveCanonicalHost: 'acme.tenants.example',
        isAlias: true,
        storefrontEnabled: true,
      }),
    );

    const req = new NextRequest(
      'https://acme.ecomate.bd:3000/products/x?page=2',
      { headers: { host: 'acme.ecomate.bd:3000' } },
    );
    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://acme.tenants.example/products/x?page=2',
    );
  });

  it('serves a host the backend says is canonical', async () => {
    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        canonicalHost: 'acme.tenants.example',
        effectiveCanonicalHost: 'acme.tenants.example',
        isAlias: false,
        storefrontEnabled: true,
      }),
    );

    const res = await proxy(request('acme.tenants.example', '/products/x'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('never redirects /api on a verdict alias (exempt path)', async () => {
    const res = await proxy(request('acme.ecomate.bd', '/api/products'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects to the EFFECTIVE host during a primary outage, not the dead primary', async () => {
    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        canonicalHost: 'acme.ecomate.bd',
        effectiveCanonicalHost: 'acme.alias.example',
        isAlias: true,
        storefrontEnabled: true,
      }),
    );

    const res = await proxy(request('acme.other.example', '/products'));

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://acme.alias.example/products',
    );
  });

  it('serves the fallback host during an outage instead of redirecting', async () => {
    fetchMock.mockResolvedValue(
      resolveResponse({
        tenantId: 'tenant-acme',
        slug: 'acme',
        canonicalHost: 'acme.ecomate.bd',
        effectiveCanonicalHost: 'acme.alias.example',
        isAlias: true,
        storefrontEnabled: true,
      }),
    );

    const res = await proxy(request('acme.alias.example', '/products'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
