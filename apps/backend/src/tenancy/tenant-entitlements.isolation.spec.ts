import { TenantRegistryRecord, TenantRegistryService } from './tenant-registry.service';
import { runWithTenant } from './tenant-context';
import { TenantEntitlementsService } from './tenant-entitlements.service';

const alpha = { tenantId: '11111111-1111-4111-8111-111111111111', slug: 'alpha' };
const beta = { tenantId: '22222222-2222-4222-8222-222222222222', slug: 'beta' };

function record(
  context: { tenantId: string; slug: string },
  overrides: Partial<TenantRegistryRecord> = {},
): TenantRegistryRecord {
  return {
    id: context.tenantId,
    slug: context.slug,
    status: 'ACTIVE',
    hosts: [`${context.slug}.ecomate.bd`],
    features: ['admin_products'],
    limits: { products: 10 },
    planName: 'Starter',
    subscriptionStatus: 'ACTIVE',
    ...overrides,
  };
}

function view(service: TenantEntitlementsService, context: typeof alpha) {
  return runWithTenant(context, () => ({
    features: service.getActiveFeatures(),
    canUseProducts: service.canUse('admin_products'),
    canUseAccounting: service.canUse('admin_accounting'),
    limits: service.getLimits(),
    planName: service.getPlanName(),
    accessState: service.getAccessState(),
  }));
}

describe('Tenant entitlements — two-tenant isolation', () => {
  let registry: TenantRegistryService;
  let service: TenantEntitlementsService;

  beforeEach(() => {
    registry = new TenantRegistryService();
    service = new TenantEntitlementsService(registry);
    registry.replace([record(alpha), record(beta)]);
  });

  it('changing one tenant plan does not affect the other tenant', () => {
    const alphaBefore = view(service, alpha);
    const betaBefore = view(service, beta);

    registry.upsert(
      record(alpha, {
        features: ['admin_accounting', 'admin_orders'],
        limits: { products: 500, staff_users: 20 },
        planName: 'Growth',
      }),
    );

    const alphaAfter = view(service, alpha);
    const betaAfter = view(service, beta);

    expect(alphaBefore).toMatchObject({
      features: ['admin_products'],
      canUseProducts: true,
      canUseAccounting: false,
      limits: { products: 10 },
      planName: 'Starter',
    });
    expect(alphaAfter).toMatchObject({
      features: ['admin_accounting', 'admin_orders'],
      canUseProducts: false,
      canUseAccounting: true,
      limits: { products: 500, staff_users: 20 },
      planName: 'Growth',
    });
    // Untouched tenant keeps its original snapshot in every dimension.
    expect(betaAfter).toEqual(betaBefore);
  });

  it('suspending one tenant leaves the other writable', () => {
    registry.upsert(record(beta, { status: 'SUSPENDED' }));

    expect(view(service, alpha).accessState).toBe('full');
    expect(view(service, beta).accessState).toBe('suspended');
  });

  it('a plan change is visible immediately, without a poll or cache flush', () => {
    expect(view(service, alpha).canUseAccounting).toBe(false);

    registry.upsert(record(alpha, { features: ['admin_accounting'] }));

    expect(view(service, alpha).canUseAccounting).toBe(true);
    // beta was never granted the feature.
    expect(view(service, beta).canUseAccounting).toBe(false);
  });
});
