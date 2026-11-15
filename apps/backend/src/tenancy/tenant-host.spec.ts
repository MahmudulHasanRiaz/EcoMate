import {
  canonicalTenantHost,
  readTenantDomainConfig,
  resolveTenantHost,
} from './tenant-host';

const config = readTenantDomainConfig({
  SAAS_PRIMARY_DOMAIN: 'ecomate.bd',
  SAAS_BASE_DOMAINS: 'ecomate.bd,alias.example',
  SAAS_FALLBACK_DOMAIN: 'alias.example',
  SAAS_CUSTOM_DOMAIN_CNAME: 'cname.ecomate.bd',
} as NodeJS.ProcessEnv);

describe('tenant host resolution', () => {
  it('defaults to ecomate.bd', () => {
    const defaults = readTenantDomainConfig({} as NodeJS.ProcessEnv);
    expect(defaults.primaryDomain).toBe('ecomate.bd');
    expect(defaults.baseDomains).toEqual(['ecomate.bd']);
    expect(defaults.customDomainCname).toBe('cname.ecomate.bd');
    expect(defaults.platformHosts.platformAdmin).toBe('saas.ecomate.bd');
  });

  it('resolves the primary and alias tenant subdomains', () => {
    expect(resolveTenantHost('acme.ecomate.bd', config)).toEqual({
      kind: 'tenant',
      slug: 'acme',
      baseDomain: 'ecomate.bd',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: false,
    });
    expect(resolveTenantHost('acme.alias.example', config)).toMatchObject({
      kind: 'tenant',
      slug: 'acme',
      baseDomain: 'alias.example',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: true,
    });
  });

  it('resolves platform hosts and rejects reserved tenant slugs', () => {
    expect(resolveTenantHost('saas.ecomate.bd', config)).toMatchObject({
      kind: 'platform',
      role: 'platformAdmin',
    });
    expect(resolveTenantHost('www.ecomate.bd', config)).toMatchObject({
      kind: 'platform',
      role: 'landing',
    });
    expect(resolveTenantHost('admin.ecomate.bd', config)).toEqual({
      kind: 'unknown',
      host: 'admin.ecomate.bd',
    });
  });

  it('treats an unrelated host as a custom domain', () => {
    expect(resolveTenantHost('shop.example.com', config)).toEqual({
      kind: 'custom',
      host: 'shop.example.com',
    });
  });

  it('normalises ports/protocols and builds canonical hosts', () => {
    expect(resolveTenantHost('ACME.ecomate.bd:443', config)).toMatchObject({
      kind: 'tenant',
      slug: 'acme',
    });
    expect(canonicalTenantHost('acme', config)).toBe('acme.ecomate.bd');
    expect(canonicalTenantHost('acme', config, 'shop.example.com')).toBe(
      'shop.example.com',
    );
  });

  it('treats an explicitly allowed external fallback as an alias base', () => {
    const externalFallback = readTenantDomainConfig({
      SAAS_PRIMARY_DOMAIN: 'ecomate.bd',
      SAAS_BASE_DOMAINS: 'ecomate.bd',
      SAAS_FALLBACK_DOMAIN: 'fallback.example',
      SAAS_ALLOW_EXTERNAL_FALLBACK: 'true',
    } as NodeJS.ProcessEnv);

    expect(externalFallback.baseDomains).toEqual([
      'ecomate.bd',
      'fallback.example',
    ]);
    expect(resolveTenantHost('acme.fallback.example', externalFallback)).toMatchObject({
      kind: 'tenant',
      slug: 'acme',
      baseDomain: 'fallback.example',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: true,
    });
  });
});
