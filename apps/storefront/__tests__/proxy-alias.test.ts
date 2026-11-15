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
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    const res = await proxy(request('shop.example.com', '/products'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBeNull();
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

  it('falls open when the registry is unreachable (availability)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await proxy(request('unknown.example.com', '/products'));
    expect(res.status).toBe(200);
  });

  it('skips registry lookup for canonical base-domain hosts', async () => {
    const res = await proxy(request('acme.ecomate.bd', '/products'));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
