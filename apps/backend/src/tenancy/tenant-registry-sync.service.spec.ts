import { TenantRegistryService } from './tenant-registry.service';
import { TenantRegistrySyncService } from './tenant-registry-sync.service';

describe('TenantRegistrySyncService', () => {
  const ORIGINAL_ENV = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fetches the platform registry with the service token and replaces records', async () => {
    process.env.PLATFORM_API_URL = 'http://platform.test/api/';
    process.env.INTERNAL_SERVICE_SECRET = 'service-secret';

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tenants: [
          {
            id: 'tenant-1',
            slug: 'acme',
            status: 'ACTIVE',
            hosts: ['acme.ecomate.bd', 'shop.example.com'],
            subscription: {
              status: 'ACTIVE',
              currentPeriodEnd: '2027-01-01T00:00:00.000Z',
            },
            plan: {
              name: 'Growth',
              features: ['admin_products', 'admin_orders'],
              limits: { products: 100 },
            },
          },
        ],
      }),
    });
    global.fetch = fetchMock as any;

    const registry = new TenantRegistryService();
    const service = new TenantRegistrySyncService(registry);

    await expect(service.refreshNow()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://platform.test/api/internal/tenants/registry',
      expect.objectContaining({
        headers: { 'x-platform-service-token': 'service-secret' },
      }),
    );
    expect(registry.resolveBySlug('acme')?.id).toBe('tenant-1');
    expect(registry.resolveByHost('shop.example.com')?.slug).toBe('acme');
    expect(registry.resolveBySlug('acme')).toMatchObject({
      features: ['admin_products', 'admin_orders'],
      limits: { products: 100 },
      planName: 'Growth',
      subscriptionStatus: 'ACTIVE',
      currentPeriodEnd: '2027-01-01T00:00:00.000Z',
    });
    expect(service.getStatus()).toMatchObject({
      tenants: 1,
      lastError: null,
    });
  });

  it('keeps the last-known-good registry when the platform API fails', async () => {
    process.env.PLATFORM_API_URL = 'http://platform.test/api';
    process.env.INTERNAL_SERVICE_SECRET = 'service-secret';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;

    const registry = new TenantRegistryService();
    registry.replace([
      { id: 'old', slug: 'acme', status: 'ACTIVE', hosts: ['acme.ecomate.bd'] },
    ]);
    const service = new TenantRegistrySyncService(registry);

    await expect(service.refreshNow()).resolves.toBe(false);
    expect(registry.resolveBySlug('acme')?.id).toBe('old');
    expect(service.getStatus().lastError).toContain('network down');
  });

  it('disables itself when the platform URL/secret are missing', async () => {
    delete process.env.PLATFORM_API_URL;
    delete process.env.INTERNAL_SERVICE_SECRET;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const service = new TenantRegistrySyncService(new TenantRegistryService());
    await expect(service.refreshNow()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('syncs the domain config from the registry payload', async () => {
    process.env.PLATFORM_API_URL = 'http://platform.test/api';
    process.env.INTERNAL_SERVICE_SECRET = 'service-secret';
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        domains: {
          primaryDomain: 'tenants.example',
          baseDomains: ['tenants.example', 'alias.example'],
          customDomainCname: 'cname.tenants.example',
          allowExternalFallback: false,
          platformHosts: {
            landing: 'www.tenants.example',
            platformAdmin: 'saas.app.example.net',
            platformApi: 'api.app.example.net',
            webhooks: 'api.app.example.net',
          },
        },
        tenants: [],
      }),
    }) as any;

    const registry = new TenantRegistryService();
    const service = new TenantRegistrySyncService(registry);

    await expect(service.refreshNow()).resolves.toBe(true);

    expect(registry.getDomainConfigSource()).toBe('synced');
    expect(registry.getDomainConfig()).toMatchObject({
      primaryDomain: 'tenants.example',
      baseDomains: ['tenants.example', 'alias.example'],
    });
    expect(registry.getDomainConfigUpdatedAt()).toBeInstanceOf(Date);
  });

  it('keeps the previous domain config when the payload omits or mangles domains', async () => {
    process.env.PLATFORM_API_URL = 'http://platform.test/api';
    process.env.INTERNAL_SERVICE_SECRET = 'service-secret';
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';

    const registry = new TenantRegistryService();
    const service = new TenantRegistrySyncService(registry);

    // First sync: valid domains.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        domains: {
          primaryDomain: 'tenants.example',
          baseDomains: ['tenants.example'],
        },
        tenants: [],
      }),
    }) as any;
    await service.refreshNow();
    expect(registry.getDomainConfig().primaryDomain).toBe('tenants.example');

    // Second sync: malformed domains — previous config survives.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ domains: { primaryDomain: 'bad!!' }, tenants: [] }),
    }) as any;
    await expect(service.refreshNow()).resolves.toBe(true);
    expect(registry.getDomainConfig().primaryDomain).toBe('tenants.example');

    // Third sync: no domains key at all (older platform API) — same.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tenants: [] }),
    }) as any;
    await expect(service.refreshNow()).resolves.toBe(true);
    expect(registry.getDomainConfig().primaryDomain).toBe('tenants.example');
  });
});
