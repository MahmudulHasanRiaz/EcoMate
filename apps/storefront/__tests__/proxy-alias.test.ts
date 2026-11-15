import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

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
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('301s alias hosts to the canonical host and marks the response noindex', () => {
    const res = proxy(request('acme.alias.example', '/products/x?page=2'));

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://acme.ecomate.bd/products/x?page=2',
    );
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('serves the canonical host without redirect or noindex', () => {
    const res = proxy(request('acme.ecomate.bd', '/products/x'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-robots-tag')).toBeNull();
  });

  it('keeps /api answering on aliases instead of redirecting', () => {
    const res = proxy(request('acme.alias.example', '/api/products'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('still applies the landing CSP on canonical hosts', () => {
    const res = proxy(request('acme.ecomate.bd', '/landing/sale'));

    expect(res.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
    expect(res.headers.get('x-is-landing')).toBe('true');
  });

  it('redirects alias landing pages before any CSP handling', () => {
    const res = proxy(request('acme.alias.example', '/landing/sale'));

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://acme.ecomate.bd/landing/sale',
    );
  });
});
