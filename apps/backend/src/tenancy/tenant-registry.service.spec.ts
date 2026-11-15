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
});
