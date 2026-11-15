import { EntitlementsController } from './entitlements.controller';
import { TenantEntitlementsService } from '../tenancy/tenant-entitlements.service';

function mockController() {
  const entitlements = {
    getSnapshot: jest.fn().mockReturnValue({
      tenantId: 'tenant-1',
      planName: 'Growth',
      subscriptionStatus: 'ACTIVE',
      accessState: 'full',
      features: ['admin_products', 'admin_orders'],
      limits: { products: 500 },
      validUntil: '2026-12-31T00:00:00.000Z',
    }),
    getPlanName: jest.fn().mockReturnValue('Growth'),
    getActiveFeatures: jest
      .fn()
      .mockReturnValue(['admin_products', 'admin_orders']),
    getAccessState: jest.fn().mockReturnValue('full'),
  };
  const limits = {
    getUsageSnapshot: jest.fn().mockResolvedValue({
      planName: 'Growth',
      accessState: 'full',
      limits: [
        {
          key: 'products',
          label: 'Products',
          limit: 500,
          used: 120,
          percent: 24,
          warning: false,
        },
      ],
    }),
  };
  const registrySync = {
    refreshNow: jest.fn().mockResolvedValue(true),
    getStatus: jest.fn().mockReturnValue({
      lastRefreshAt: '2026-11-15T00:00:00.000Z',
      lastError: null,
      tenants: 2,
    }),
  };
  return {
    entitlements,
    limits,
    registrySync,
    controller: new EntitlementsController(
      entitlements as unknown as TenantEntitlementsService,
      limits as any,
      registrySync as any,
    ),
  };
}

describe('EntitlementsController', () => {
  it('returns the full snapshot for the authenticated tenant', () => {
    const { controller, entitlements } = mockController();
    const snapshot = controller.getMine();

    expect(entitlements.getSnapshot).toHaveBeenCalled();
    expect(snapshot).toEqual({
      tenantId: 'tenant-1',
      planName: 'Growth',
      subscriptionStatus: 'ACTIVE',
      accessState: 'full',
      features: ['admin_products', 'admin_orders'],
      limits: { products: 500 },
      validUntil: '2026-12-31T00:00:00.000Z',
    });
  });

  it('exposes only plan name, features and access state publicly', () => {
    const { controller } = mockController();
    const result = controller.getPublic();

    expect(result).toEqual({
      planName: 'Growth',
      features: ['admin_products', 'admin_orders'],
      accessState: 'full',
    });
    expect(result).not.toHaveProperty('limits');
    expect(result).not.toHaveProperty('tenantId');
    expect(result).not.toHaveProperty('subscriptionStatus');
  });

  it('returns the plan usage snapshot', async () => {
    const { controller, limits } = mockController();
    const usage = await controller.getUsage();

    expect(limits.getUsageSnapshot).toHaveBeenCalled();
    expect(usage.limits[0]).toEqual({
      key: 'products',
      label: 'Products',
      limit: 500,
      used: 120,
      percent: 24,
      warning: false,
    });
  });

  it('refreshes the registry on the platform push endpoint', async () => {
    const { controller, registrySync } = mockController();
    const result = await controller.refresh();

    expect(registrySync.refreshNow).toHaveBeenCalled();
    expect(result).toEqual({
      refreshed: true,
      lastRefreshAt: '2026-11-15T00:00:00.000Z',
      lastError: null,
      tenants: 2,
    });
  });

  it('reports a failed platform refresh instead of pretending it succeeded', async () => {
    const { controller, registrySync } = mockController();
    registrySync.refreshNow.mockResolvedValueOnce(false);
    registrySync.getStatus.mockReturnValueOnce({
      lastRefreshAt: null,
      lastError: 'platform registry HTTP 503',
      tenants: 0,
    });

    const result = await controller.refresh();
    expect(result.refreshed).toBe(false);
    expect(result.lastError).toBe('platform registry HTTP 503');
  });
});
