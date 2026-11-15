import { TenantRegistryService } from './tenant-registry.service';
import { runWithTenant } from './tenant-context';
import { TenantEntitlementsService } from './tenant-entitlements.service';

describe('TenantEntitlementsService', () => {
  const originalEnv = { ...process.env };
  const registry = new TenantRegistryService();
  const service = new TenantEntitlementsService(registry);
  const context = { tenantId: 'tenant-1', slug: 'acme' };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SKIP_LICENSE_CHECK;
    registry.replace([]);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('opens the wildcard in dev when no platform snapshot exists', () => {
    process.env.NODE_ENV = 'development';
    const result = runWithTenant(context, () => ({
      canUse: service.canUse('admin_products'),
      features: service.getActiveFeatures(),
    }));
    expect(result.canUse).toBe(true);
    expect(result.features).toEqual(['*']);
  });

  it('uses the registry plan features and limits', () => {
    registry.replace([
      {
        id: context.tenantId,
        slug: context.slug,
        status: 'ACTIVE',
        hosts: [],
        features: ['admin_products', 'admin_orders'],
        limits: { products: 100 },
        planName: 'Growth',
        subscriptionStatus: 'ACTIVE',
      },
    ]);

    const result = runWithTenant(context, () => ({
      product: service.canUse('admin_products'),
      accounting: service.canUse('admin_accounting'),
      features: service.getActiveFeatures(),
      limits: service.getLimits(),
      plan: service.getPlanName(),
      access: service.getAccessState(),
    }));

    expect(result.product).toBe(true);
    expect(result.accounting).toBe(false);
    expect(result.features).toEqual(['admin_products', 'admin_orders']);
    expect(result.limits).toEqual({ products: 100 });
    expect(result.plan).toBe('Growth');
    expect(result.access).toBe('full');
  });

  it('fails closed in production when no snapshot exists', () => {
    process.env.NODE_ENV = 'production';
    const result = runWithTenant(context, () => ({
      canUse: service.canUse('admin_products'),
      features: service.getActiveFeatures(),
      access: service.getAccessState(),
    }));
    expect(result.canUse).toBe(false);
    expect(result.features).toEqual([]);
    expect(result.access).toBe('read_only');
  });

  it('uses grace while past_due is inside the grace window, then read_only', () => {
    registry.replace([
      {
        id: context.tenantId,
        slug: context.slug,
        status: 'ACTIVE',
        hosts: [],
        features: ['admin_products'],
        subscriptionStatus: 'PAST_DUE',
        graceEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    ]);
    expect(runWithTenant(context, () => service.getAccessState())).toBe('grace');

    registry.replace([
      {
        id: context.tenantId,
        slug: context.slug,
        status: 'ACTIVE',
        hosts: [],
        features: ['admin_products'],
        subscriptionStatus: 'PAST_DUE',
        graceEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ]);
    expect(runWithTenant(context, () => service.getAccessState())).toBe(
      'read_only',
    );
  });

  it('suspends a tenant whose platform status is not ACTIVE', () => {
    registry.replace([
      {
        id: context.tenantId,
        slug: context.slug,
        status: 'SUSPENDED',
        hosts: [],
        features: ['admin_products'],
        subscriptionStatus: 'ACTIVE',
      },
    ]);
    expect(runWithTenant(context, () => service.getAccessState())).toBe(
      'suspended',
    );
  });
});
