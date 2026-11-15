import { describe, it, expect } from 'vitest';
import {
  aliasRedirectTarget,
  isBaseOrPlatformHost,
  readDomainConfig,
  resolveBaseDomainAlias,
} from '../tenant-host';

const config = readDomainConfig({
  SAAS_PRIMARY_DOMAIN: 'ecomate.bd',
  SAAS_BASE_DOMAINS: 'ecomate.bd,alias.example',
} as unknown as NodeJS.ProcessEnv);

describe('storefront base-domain alias resolution', () => {
  it('marks the primary subdomain as canonical', () => {
    expect(resolveBaseDomainAlias('acme.ecomate.bd', config)).toEqual({
      slug: 'acme',
      baseDomain: 'ecomate.bd',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: false,
    });
    expect(aliasRedirectTarget('acme.ecomate.bd', '/products', '', config)).toBeNull();
  });

  it('301s an alias base domain to the primary canonical host', () => {
    expect(resolveBaseDomainAlias('acme.alias.example', config)).toEqual({
      slug: 'acme',
      baseDomain: 'alias.example',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: true,
    });
    expect(
      aliasRedirectTarget('acme.alias.example', '/products/x', '?page=2', config),
    ).toBe('https://acme.ecomate.bd/products/x?page=2');
  });

  it('normalises case, ports and protocol prefixes', () => {
    expect(
      aliasRedirectTarget('ACME.Alias.Example:443', '/cart', '', config),
    ).toBe('https://acme.ecomate.bd/cart');
    expect(
      aliasRedirectTarget('https://acme.alias.example', '/products', '', config),
    ).toBe('https://acme.ecomate.bd/products');
  });

  it('never redirects platform hosts, reserved slugs or multi-label hosts', () => {
    for (const host of [
      'www.ecomate.bd',
      'admin.ecomate.bd',
      'admin.alias.example',
      'foo.bar.alias.example',
    ]) {
      expect(resolveBaseDomainAlias(host, config)).toBeNull();
    }

    expect(resolveBaseDomainAlias('acme.ecomate.bd', config)).toEqual({
      slug: 'acme',
      baseDomain: 'ecomate.bd',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: false,
    });
  });

  it('leaves unknown/custom hosts alone (custom-domain unit)', () => {
    expect(resolveBaseDomainAlias('shop.example.com', config)).toBeNull();
    expect(aliasRedirectTarget('shop.example.com', '/', '', config)).toBeNull();
  });

  it('defaults to ecomate.bd when the env is absent', () => {
    const defaults = readDomainConfig({} as NodeJS.ProcessEnv);
    expect(defaults.primaryDomain).toBe('ecomate.bd');
    expect(defaults.baseDomains).toEqual(['ecomate.bd']);
    expect(resolveBaseDomainAlias('acme.ecomate.bd', defaults)).toMatchObject({
      canonicalHost: 'acme.ecomate.bd',
      isAlias: false,
    });
  });

  it('treats an explicitly allowed external fallback as an alias base', () => {
    const external = readDomainConfig({
      SAAS_PRIMARY_DOMAIN: 'ecomate.bd',
      SAAS_BASE_DOMAINS: 'ecomate.bd',
      SAAS_FALLBACK_DOMAIN: 'fallback.example',
      SAAS_ALLOW_EXTERNAL_FALLBACK: 'true',
    } as unknown as NodeJS.ProcessEnv);

    expect(external.baseDomains).toEqual(['ecomate.bd', 'fallback.example']);
    expect(resolveBaseDomainAlias('acme.fallback.example', external)).toEqual({
      slug: 'acme',
      baseDomain: 'fallback.example',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: true,
    });
  });

  it('identifies platform/base hosts the storefront must not serve', () => {
    for (const host of [
      'ecomate.bd',
      'www.ecomate.bd',
      'saas.alias.example',
      'cname.ecomate.bd',
      'api.ecomate.bd',
    ]) {
      expect(isBaseOrPlatformHost(host, config)).toBe(true);
    }
    expect(isBaseOrPlatformHost('acme.ecomate.bd', config)).toBe(false);
    expect(isBaseOrPlatformHost('shop.example.com', config)).toBe(false);
  });

  it('uses the fallback base for redirects during a primary outage', () => {
    const outage = readDomainConfig({
      SAAS_PRIMARY_DOMAIN: 'ecomate.bd',
      SAAS_BASE_DOMAINS: 'ecomate.bd,alias.example,other.example',
      SAAS_FALLBACK_DOMAIN: 'alias.example',
      SAAS_PRIMARY_UNHEALTHY: 'true',
    } as unknown as NodeJS.ProcessEnv);

    // A non-fallback alias bounces to the reachable fallback host, not the
    // unreachable primary.
    expect(aliasRedirectTarget('acme.other.example', '/products', '', outage)).toBe(
      'https://acme.alias.example/products',
    );
    // The fallback host is the effective base: serve it, never redirect.
    expect(
      aliasRedirectTarget('acme.alias.example', '/products', '', outage),
    ).toBeNull();
    // Canonical primary hosts are not rewritten by the storefront proxy.
    expect(aliasRedirectTarget('acme.ecomate.bd', '/products', '', outage)).toBeNull();
  });
});
