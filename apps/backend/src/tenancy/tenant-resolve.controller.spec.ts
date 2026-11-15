import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantRegistryService } from './tenant-registry.service';
import { TenantResolveController } from './tenant-resolve.controller';

const ORIGINAL_ENV = { ...process.env };

function makeController() {
  const registry = new TenantRegistryService();
  registry.replace([
    {
      id: 'tenant-acme',
      slug: 'acme',
      status: 'ACTIVE',
      hosts: ['acme.ecomate.bd', 'shop.example.com'],
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
    expect(makeController().resolve('acme.ecomate.bd')).toEqual({
      kind: 'tenant',
      tenantId: 'tenant-acme',
      slug: 'acme',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: false,
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
    expect(makeController().resolve('Shop.Example.com')).toEqual({
      kind: 'custom',
      tenantId: 'tenant-acme',
      slug: 'acme',
      canonicalHost: 'shop.example.com',
      isAlias: false,
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
});
