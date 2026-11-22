import { TenantRegistryService } from './tenant-registry.service';

describe('TenantRegistryService', () => {
  let registry: TenantRegistryService;

  beforeEach(() => {
    registry = new TenantRegistryService();
  });

  it('indexes tenants by slug and normalised host', () => {
    registry.replace([
      {
        id: 't1',
        slug: 'acme',
        status: 'ACTIVE',
        hosts: ['acme.ecomate.bd', 'shop.example.com'],
      },
      {
        id: 't2',
        slug: 'beta',
        status: 'TRIAL',
        hosts: ['beta.ecomate.bd'],
      },
    ]);

    expect(registry.size()).toBe(2);
    expect(registry.resolveBySlug('ACME')?.id).toBe('t1');
    expect(registry.resolveByHost('ACME.ecomate.bd:443')?.id).toBe('t1');
    expect(registry.resolveByHost('shop.example.com')?.id).toBe('t1');
    expect(registry.resolveByHost('beta.ecomate.bd')?.id).toBe('t2');
    expect(registry.resolveByHost('unknown.example')).toBeUndefined();
  });

  it('replaces and removes records without stale host mappings', () => {
    registry.replace([
      { id: 't1', slug: 'acme', status: 'ACTIVE', hosts: ['acme.ecomate.bd'] },
    ]);

    registry.upsert({
      id: 't1',
      slug: 'acme',
      status: 'SUSPENDED',
      hosts: ['acme.ecomate.bd', 'new.example.com'],
    });

    expect(registry.resolveBySlug('acme')?.status).toBe('SUSPENDED');
    expect(registry.resolveByHost('new.example.com')?.id).toBe('t1');

    registry.remove('acme');
    expect(registry.resolveBySlug('acme')).toBeUndefined();
    expect(registry.resolveByHost('new.example.com')).toBeUndefined();
  });

  it('resolves by id and drops the id index on remove', () => {
    registry.replace([
      { id: 't1', slug: 'acme', status: 'ACTIVE', hosts: [] },
    ]);
    expect(registry.resolveById('t1')?.slug).toBe('acme');
    expect(registry.resolveById('missing')).toBeUndefined();
    registry.remove('acme');
    expect(registry.resolveById('t1')).toBeUndefined();
  });

  it('falls back to the env domain config until a sync arrives', () => {
    const originalEnv = { ...process.env };
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    try {
      expect(registry.getDomainConfigSource()).toBe('env');
      expect(registry.getDomainConfig().primaryDomain).toBe('ecomate.bd');
      expect(registry.getDomainConfigUpdatedAt()).toBeNull();
    } finally {
      process.env = originalEnv;
    }
  });

  it('prefers the synced domain config once set', () => {
    const originalEnv = { ...process.env };
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    try {
      registry.setDomainConfig({
        primaryDomain: 'tenants.example',
        baseDomains: ['tenants.example'],
        customDomainCname: 'cname.tenants.example',
        allowExternalFallback: false,
        platformHosts: {
          landing: 'www.tenants.example',
          platformAdmin: 'saas.app.example.net',
          platformApi: 'api.app.example.net',
          webhooks: 'api.app.example.net',
        },
      });
      expect(registry.getDomainConfigSource()).toBe('synced');
      expect(registry.getDomainConfig().primaryDomain).toBe(
        'tenants.example',
      );
      expect(registry.getDomainConfigUpdatedAt()).toBeInstanceOf(Date);
    } finally {
      process.env = originalEnv;
    }
  });
});
