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
    delete process.env.NODE_ENV;
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

  it('exposes graceEndsAt in the snapshot (trial-ended banner)', () => {
    const graceEndsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    registry.replace([
      {
        id: context.tenantId,
        slug: context.slug,
        status: 'PAST_DUE',
        hosts: [],
        features: ['admin_products'],
        limits: {},
        planName: 'Trial',
        subscriptionStatus: 'PAST_DUE',
        graceEndsAt,
      },
    ]);
    const result = runWithTenant(context, () => service.getSnapshot());
    expect(result.graceEndsAt).toBe(graceEndsAt);
    expect(result.accessState).toBe('grace');
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

  it('gives a trial tenant full access (Phase 7: TRIAL is operating)', () => {
    registry.replace([
      {
        id: context.tenantId,
        slug: context.slug,
        status: 'TRIAL',
        hosts: [],
        features: ['admin_products'],
        subscriptionStatus: 'TRIAL',
      },
    ]);
    expect(runWithTenant(context, () => service.getAccessState())).toBe('full');
  });

  it('honours the grace window for a PAST_DUE tenant', () => {
    const base: any = {
      id: context.tenantId,
      slug: context.slug,
      status: 'PAST_DUE',
      hosts: [],
      features: ['admin_products'],
      subscriptionStatus: 'PAST_DUE',
    };
    registry.replace([
      {
        ...base,
        graceEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    ]);
    expect(runWithTenant(context, () => service.getAccessState())).toBe('grace');

    registry.replace([
      {
        ...base,
        graceEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ]);
    expect(runWithTenant(context, () => service.getAccessState())).toBe(
      'read_only',
    );
  });

  it('falls back to validUntil when graceEndsAt is absent', () => {
    registry.replace([
      {
        id: context.tenantId,
        slug: context.slug,
        status: 'PAST_DUE',
        hosts: [],
        features: ['admin_products'],
        subscriptionStatus: 'PAST_DUE',
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      },
    ]);
    expect(runWithTenant(context, () => service.getAccessState())).toBe('grace');
  });

  it('treats an expired subscription as read-only', () => {
    registry.replace([
      {
        id: context.tenantId,
        slug: context.slug,
        status: 'ACTIVE',
        hosts: [],
        features: ['admin_products'],
        subscriptionStatus: 'EXPIRED',
      },
    ]);
    expect(runWithTenant(context, () => service.getAccessState())).toBe(
      'read_only',
    );
  });

  it('suspends on CANCELLED and CANCELED alike', () => {
    for (const subscriptionStatus of ['CANCELLED', 'CANCELED']) {
      registry.replace([
        {
          id: context.tenantId,
          slug: context.slug,
          status: 'ACTIVE',
          hosts: [],
          features: ['admin_products'],
          subscriptionStatus,
        },
      ]);
      expect(runWithTenant(context, () => service.getAccessState())).toBe(
        'suspended',
      );
    }
  });
});
