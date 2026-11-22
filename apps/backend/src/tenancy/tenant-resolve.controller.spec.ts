import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantRegistryService } from './tenant-registry.service';
import { TenantResolveController } from './tenant-resolve.controller';

const ORIGINAL_ENV = { ...process.env };

function makeController(features?: string[]) {
  const registry = new TenantRegistryService();
  registry.replace([
    {
      id: 'tenant-acme',
      slug: 'acme',
      status: 'ACTIVE',
      hosts: ['acme.ecomate.bd', 'shop.example.com'],
      features,
    },
  ]);
  return new TenantResolveController(registry);
}

describe('TenantResolveController', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    delete process.env.SAAS_FALLBACK_DOMAIN;
    delete process.env.SAAS_ALLOW_EXTERNAL_FALLBACK;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('resolves a canonical tenant host', () => {
    expect(makeController(['storefront']).resolve('acme.ecomate.bd')).toEqual({
      kind: 'tenant',
      tenantId: 'tenant-acme',
      slug: 'acme',
      canonicalHost: 'acme.ecomate.bd',
      effectiveCanonicalHost: 'acme.ecomate.bd',
      isAlias: false,
      storefrontEnabled: true,
    });
  });

  it('resolves a base-domain alias to the canonical host', () => {
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';
    expect(makeController().resolve('acme.alias.example')).toMatchObject({
      kind: 'tenant',
      slug: 'acme',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: true,
    });
  });

  it('resolves a registered custom domain', () => {
    expect(makeController(['storefront']).resolve('Shop.Example.com')).toEqual({
      kind: 'custom',
      tenantId: 'tenant-acme',
      slug: 'acme',
      canonicalHost: 'shop.example.com',
      isAlias: false,
      storefrontEnabled: true,
    });
  });

  it('reports storefrontEnabled false when the tenant lacks the storefront feature', () => {
    expect(
      makeController(['admin_products']).resolve('acme.ecomate.bd'),
    ).toMatchObject({ storefrontEnabled: false });
    expect(
      makeController(['admin_products']).resolve('shop.example.com'),
    ).toMatchObject({ storefrontEnabled: false });
  });

  it('reports storefrontEnabled true for the * wildcard', () => {
    expect(makeController(['*']).resolve('acme.ecomate.bd')).toMatchObject({
      storefrontEnabled: true,
    });
  });

  it('reports storefrontEnabled false when the tenant has no plan features', () => {
    // features undefined = no plan assigned — fail closed, like every
    // other entitlement check.
    expect(makeController().resolve('acme.ecomate.bd')).toMatchObject({
      storefrontEnabled: false,
    });
  });

  it.each([
    'unknown.example.com',
    'www.ecomate.bd',
    'admin.ecomate.bd',
    'ghost.ecomate.bd',
  ])('never routes %s to a tenant', (host) => {
    expect(() => makeController().resolve(host)).toThrow(NotFoundException);
  });

  it('requires a host', () => {
    expect(() => makeController().resolve(undefined)).toThrow(
      BadRequestException,
    );
  });

  it('resolves hosts under the SYNCED tenant domain, not the env domain', () => {
    const registry = new TenantRegistryService();
    registry.replace([
      {
        id: 'tenant-acme',
        slug: 'acme',
        status: 'ACTIVE',
        hosts: ['acme.ecomate.bd', 'shop.example.com'],
        features: ['storefront'],
      },
    ]);
    registry.setDomainConfig({
      primaryDomain: 'tenants.example',
      baseDomains: ['tenants.example', 'ecomate.bd'],
      customDomainCname: 'cname.tenants.example',
      allowExternalFallback: false,
      platformHosts: {
        landing: 'www.tenants.example',
        platformAdmin: 'saas.app.example.net',
        platformApi: 'api.app.example.net',
        webhooks: 'api.app.example.net',
      },
    });
    const controller = new TenantResolveController(registry);

    // New tenant domain: canonical.
    expect(controller.resolve('acme.tenants.example')).toEqual({
      kind: 'tenant',
      tenantId: 'tenant-acme',
      slug: 'acme',
      canonicalHost: 'acme.tenants.example',
      effectiveCanonicalHost: 'acme.tenants.example',
      isAlias: false,
      storefrontEnabled: true,
    });
    // Old env domain kept as an alias base: resolves, alias-flagged.
    expect(controller.resolve('acme.ecomate.bd')).toMatchObject({
      kind: 'tenant',
      slug: 'acme',
      canonicalHost: 'acme.tenants.example',
      isAlias: true,
    });
    // The split app host is never a tenant.
    expect(() => controller.resolve('saas.app.example.net')).toThrow(
      NotFoundException,
    );
  });

  it('points redirects at the fallback base during a primary outage', () => {
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';
    process.env.SAAS_FALLBACK_DOMAIN = 'alias.example';
    process.env.SAAS_PRIMARY_UNHEALTHY = 'true';
    expect(makeController(['storefront']).resolve('acme.alias.example')).toMatchObject({
      kind: 'tenant',
      slug: 'acme',
      // Canonical identity does not move...
      canonicalHost: 'acme.ecomate.bd',
      // ...but the redirect target is the reachable fallback host.
      effectiveCanonicalHost: 'acme.alias.example',
      isAlias: true,
    });
  });
});
