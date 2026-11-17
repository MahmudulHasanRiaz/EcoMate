import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearHostResolutionCache, proxy } from '../proxy';

const originalEnv = { ...process.env };

function request(host: string, path: string) {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host },
  });
}

describe('storefront proxy alias canonicalisation', () => {
  beforeEach(() => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';
    delete process.env.SAAS_FALLBACK_DOMAIN;
    delete process.env.SAAS_ALLOW_EXTERNAL_FALLBACK;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('301s alias hosts to the canonical host and marks the response noindex', async () => {
    const res = await proxy(request('acme.alias.example', '/products/x?page=2'));

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://acme.ecomate.bd/products/x?page=2',
    );
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('serves the canonical host without redirect or noindex', async () => {
    const res = await proxy(request('acme.ecomate.bd', '/products/x'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-robots-tag')).toBeNull();
  });

  it('keeps /api answering on aliases instead of redirecting', async () => {
    const res = await proxy(request('acme.alias.example', '/api/products'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('still applies the landing CSP on canonical hosts', async () => {
    const res = await proxy(request('acme.ecomate.bd', '/landing/sale'));

    expect(res.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
    expect(res.headers.get('x-is-landing')).toBe('true');
  });

  it('redirects alias landing pages before any CSP handling', async () => {
    const res = await proxy(request('acme.alias.example', '/landing/sale'));

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://acme.ecomate.bd/landing/sale',
    );
  });

  it('serves the fallback host during a primary outage instead of redirecting', async () => {
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example,other.example';
    process.env.SAAS_FALLBACK_DOMAIN = 'alias.example';
    process.env.SAAS_PRIMARY_UNHEALTHY = 'true';

    const served = await proxy(request('acme.alias.example', '/products'));
    expect(served.status).toBe(200);
    expect(served.headers.get('location')).toBeNull();
    // Aliases stay noindex even while serving as the outage fallback.
    expect(served.headers.get('x-robots-tag')).toBe('noindex');

    const redirected = await proxy(request('acme.other.example', '/products'));
    expect(redirected.status).toBe(301);
    expect(redirected.headers.get('location')).toBe(
      'https://acme.alias.example/products',
    );
  });
});

describe('storefront proxy unknown/custom hosts (production)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';
    process.env.API_URL = 'http://backend:4000/api';
    delete process.env.INTERNAL_SHARED_SECRET;
    clearHostResolutionCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    clearHostResolutionCache();
  });

  it('404s an unknown host instead of rendering a tenant shell', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const res = await proxy(request('unknown.example.com', '/products'));

    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tenants/resolve?host=unknown.example.com'),
      expect.any(Object),
    );
  });

  it('serves a verified custom domain returned by the registry', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: 'custom',
          tenantId: 'tenant-1',
          slug: 'acme',
          canonicalHost: 'shop.example.com',
          isAlias: false,
        }),
        { status: 200 },
      ),
    );

    const res = await proxy(request('shop.example.com', '/products'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBeNull();
    // Tenant identity is injected for SSR cache-tag namespacing.
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBe(
      'tenant-1',
    );
    expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBe('acme');
  });

  it('never serves platform/base hosts from the storefront', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    for (const host of ['www.ecomate.bd', 'saas.ecomate.bd', 'ecomate.bd']) {
      const res = await proxy(request(host, '/'));
      expect(res.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches the registry verdict per host', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    await proxy(request('unknown.example.com', '/a'));
    await proxy(request('unknown.example.com', '/b'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest entry when the host cache fills — never clears it all', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    // Fill the 1,000-entry cache with distinct unknown hosts.
    for (let i = 0; i < 1000; i++) {
      await proxy(request(`host-${i}.example.com`, '/products'));
    }
    expect(fetchMock).toHaveBeenCalledTimes(1000);

    // One more host evicts ONLY the oldest entry (host-0).
    await proxy(request('host-1000.example.com', '/products'));
    expect(fetchMock).toHaveBeenCalledTimes(1001);

    // host-0 was evicted: re-fetch. host-999 was NOT: still cached.
    await proxy(request('host-0.example.com', '/products'));
    expect(fetchMock).toHaveBeenCalledTimes(1002);
    await proxy(request('host-999.example.com', '/products'));
    expect(fetchMock).toHaveBeenCalledTimes(1002);
  });

  it('falls open when the registry is unreachable (availability)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await proxy(request('unknown.example.com', '/products'));
    expect(res.status).toBe(200);
  });

  it('looks up base-domain hosts only to stamp the tenant id, and never 404s them', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const res = await proxy(request('acme.ecomate.bd', '/products'));
    expect(res.status).toBe(200);
    // The slug is known locally even when the registry has no id yet.
    expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBe('acme');
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('injects the tenant id for a base-domain host when the registry knows it', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: 'tenant',
          tenantId: 'tenant-1',
          slug: 'acme',
          canonicalHost: 'acme.ecomate.bd',
          isAlias: false,
        }),
        { status: 200 },
      ),
    );

    const res = await proxy(request('acme.ecomate.bd', '/products'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBe(
      'tenant-1',
    );
  });
});

describe('storefront proxy /api rewrite tenant forwarding', () => {
  beforeEach(() => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';
    delete process.env.SAAS_FALLBACK_DOMAIN;
    delete process.env.SAAS_ALLOW_EXTERNAL_FALLBACK;
    process.env.INTERNAL_SHARED_SECRET = 'test-internal-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('forwards x-tenant-host AND the internal secret for /api/* requests', async () => {
    // The /api rewrite replaces Host with the backend origin, so the
    // backend can only resolve the tenant from x-tenant-host — which it
    // trusts only together with the internal secret from a private peer.
    const res = await proxy(request('acme.ecomate.bd', '/api/products'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-tenant-host')).toBe(
      'acme.ecomate.bd',
    );
    expect(res.headers.get('x-middleware-request-x-internal-secret')).toBe(
      'test-internal-secret',
    );
  });

  it('does not forward the internal secret for non-/api requests', async () => {
    const res = await proxy(request('acme.ecomate.bd', '/products/x'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-tenant-host')).toBe(
      'acme.ecomate.bd',
    );
    expect(
      res.headers.get('x-middleware-request-x-internal-secret'),
    ).toBeNull();
  });

  it('forwards only the tenant host when no secret is configured', async () => {
    delete process.env.INTERNAL_SHARED_SECRET;

    const res = await proxy(request('acme.ecomate.bd', '/api/products'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-tenant-host')).toBe(
      'acme.ecomate.bd',
    );
    expect(
      res.headers.get('x-middleware-request-x-internal-secret'),
    ).toBeNull();
  });
});
