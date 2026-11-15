import { describe, it, expect } from 'vitest';
import {
  aliasRedirectTarget,
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
      canonicalHost: 'acme.ecomate.bd',
      isAlias: false,
    });
    expect(aliasRedirectTarget('acme.ecomate.bd', '/products', '', config)).toBeNull();
  });

  it('301s an alias base domain to the primary canonical host', () => {
    expect(resolveBaseDomainAlias('acme.alias.example', config)).toEqual({
      slug: 'acme',
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
});
