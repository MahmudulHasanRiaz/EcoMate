import {
  canonicalTenantHost,
  parseTenantDomainConfig,
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

  it('resolves an alias base that is itself a subdomain of the primary', () => {
    const nested = readTenantDomainConfig({
      SAAS_PRIMARY_DOMAIN: 'ecomate.bd',
      SAAS_BASE_DOMAINS: 'ecomate.bd,shop.ecomate.bd',
      SAAS_CUSTOM_DOMAIN_CNAME: 'cname.ecomate.bd',
    } as NodeJS.ProcessEnv);
    // `shop.ecomate.bd` ends with `.ecomate.bd`, so a naive first-match
    // parse leaves the dotted slug `acme.shop` — the resolver must try
    // the longer base instead of giving up (E8 found this live: the alias
    // host 404d instead of redirecting to canonical).
    expect(resolveTenantHost('acme.shop.ecomate.bd', nested)).toEqual({
      kind: 'tenant',
      slug: 'acme',
      baseDomain: 'shop.ecomate.bd',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: true,
    });
    // Reserved slugs stay rejected on the nested base too.
    expect(resolveTenantHost('admin.shop.ecomate.bd', nested)).toEqual({
      kind: 'unknown',
      host: 'admin.shop.ecomate.bd',
    });
    // A genuinely multi-label slug under a base is unknown — it must NOT
    // fall through to 'custom', or it could be attached as a custom domain
    // under our own base.
    expect(resolveTenantHost('foo.bar.ecomate.bd', nested)).toEqual({
      kind: 'unknown',
      host: 'foo.bar.ecomate.bd',
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

describe('parseTenantDomainConfig (platform registry payload)', () => {
  const payload = {
    primaryDomain: 'tenants.example',
    baseDomains: ['tenants.example', 'alias.example'],
    appDomain: 'app.example.net',
    landingUrl: 'https://www.tenants.example',
    adminUrl: 'https://saas.app.example.net',
    fallbackDomain: null,
    customDomainCname: 'cname.tenants.example',
    allowExternalFallback: false,
    primaryHealthy: true,
    platformHosts: {
      landing: 'www.tenants.example',
      platformAdmin: 'saas.app.example.net',
      platformApi: 'api.app.example.net',
      webhooks: 'api.app.example.net',
    },
  };

  it('parses a full platform DomainConfig', () => {
    const parsed = parseTenantDomainConfig(payload);
    expect(parsed).toMatchObject({
      primaryDomain: 'tenants.example',
      baseDomains: ['tenants.example', 'alias.example'],
      customDomainCname: 'cname.tenants.example',
      platformHosts: {
        landing: 'www.tenants.example',
        platformAdmin: 'saas.app.example.net',
        platformApi: 'api.app.example.net',
        webhooks: 'api.app.example.net',
      },
    });
    expect(parsed && resolveTenantHost('acme.tenants.example', parsed)).toMatchObject({
      kind: 'tenant',
      slug: 'acme',
    });
    expect(
      parsed && resolveTenantHost('saas.app.example.net', parsed),
    ).toMatchObject({ kind: 'platform', role: 'platformAdmin' });
  });

  it('derives missing hosts/CNAME from the primary + app domain', () => {
    const parsed = parseTenantDomainConfig({
      primaryDomain: 'tenants.example',
      baseDomains: ['tenants.example'],
      appDomain: 'app.example.net',
    });
    expect(parsed).toMatchObject({
      customDomainCname: 'cname.tenants.example',
      platformHosts: {
        landing: 'www.tenants.example',
        platformAdmin: 'saas.app.example.net',
        platformApi: 'api.app.example.net',
      },
    });
  });

  it('returns null for a missing or invalid primary domain', () => {
    expect(parseTenantDomainConfig(null)).toBeNull();
    expect(parseTenantDomainConfig('nope')).toBeNull();
    expect(parseTenantDomainConfig({})).toBeNull();
    expect(
      parseTenantDomainConfig({ primaryDomain: 'not a domain' }),
    ).toBeNull();
    expect(
      parseTenantDomainConfig({ primaryDomain: 'single-label' }),
    ).toBeNull();
  });

  it('drops invalid alias entries instead of failing the whole payload', () => {
    const parsed = parseTenantDomainConfig({
      primaryDomain: 'tenants.example',
      baseDomains: ['tenants.example', 'bad host!!', 'alias.example'],
    });
    expect(parsed?.baseDomains).toEqual([
      'tenants.example',
      'alias.example',
    ]);
  });
});
