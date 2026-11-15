import { SystemSettingsController } from '../system-settings.controller';
import { runWithTenant } from '../../tenancy/tenant-context';

function mockController() {
  const prisma = {
    systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
    shippingOption: { findMany: jest.fn().mockResolvedValue([]) },
    shippingZoneGroup: { findMany: jest.fn().mockResolvedValue([]) },
    paymentOption: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    getStale: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const entitlements = {
    getActiveFeatures: jest
      .fn()
      .mockReturnValue(['storefront_wishlist', 'admin_combos']),
  };
  const controller = new SystemSettingsController(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    cache as any,
    {} as any,
    { revalidateStorefront: jest.fn() } as any,
    entitlements as any,
  );
  return { controller, cache, entitlements };
}

describe('getStorefrontConfig tenant scoping', () => {
  it('caches under the tenant-specific key and exposes plan features', async () => {
    const { controller, cache, entitlements } = mockController();

    const config = await runWithTenant(
      { tenantId: 'tenant-a', slug: 'alpha' },
      () => controller.getStorefrontConfig(),
    );

    expect(cache.get).toHaveBeenCalledWith('storefront:config:tenant-a');
    expect(cache.set).toHaveBeenCalledWith(
      'storefront:config:tenant-a',
      expect.any(Object),
    );
    expect(entitlements.getActiveFeatures).toHaveBeenCalled();
    expect((config as any).planFeatures).toEqual([
      'storefront_wishlist',
      'admin_combos',
    ]);
  });

  it('never lets one tenant read another tenant cached config', async () => {
    const { controller, cache } = mockController();

    await runWithTenant({ tenantId: 'tenant-a', slug: 'alpha' }, () =>
      controller.getStorefrontConfig(),
    );
    await runWithTenant({ tenantId: 'tenant-b', slug: 'beta' }, () =>
      controller.getStorefrontConfig(),
    );

    const keys = cache.get.mock.calls.map((call) => call[0]);
    expect(keys).toEqual([
      'storefront:config:tenant-a',
      'storefront:config:tenant-b',
    ]);
  });

  it('invalidates only the current tenant key when a setting is saved', async () => {
    const { controller, cache } = mockController();
    const prisma = (controller as any).prisma;
    prisma.systemSetting.upsert = jest.fn().mockResolvedValue({});

    await runWithTenant({ tenantId: 'tenant-a', slug: 'alpha' }, () =>
      controller.set('store_name', { value: 'Alpha' }, { role: 'admin' } as any),
    );

    expect(cache.delete).toHaveBeenCalledWith('storefront:config:tenant-a');
    expect(cache.delete).not.toHaveBeenCalledWith('storefront:config');
  });

  it('falls back to the legacy key without tenant context', async () => {
    const { controller, cache } = mockController();

    await controller.getStorefrontConfig();

    expect(cache.get).toHaveBeenCalledWith('storefront:config');
  });
});
