import { Reflector } from '@nestjs/core';
import { InternalRegistryController } from './internal-registry.controller';
import { TenantRegistryService } from './tenant-registry.service';
import { SKIP_SUBSCRIPTION_KEY } from './skip-subscription.decorator';

function makeController(refreshResult = true) {
  const registry = new TenantRegistryService();
  registry.replace([
    { id: 'tenant-acme', slug: 'acme', status: 'ACTIVE', hosts: [] },
    { id: 'tenant-beta', slug: 'beta', status: 'TRIAL', hosts: [] },
  ]);
  const sync = { refreshNow: jest.fn().mockResolvedValue(refreshResult) };
  return {
    sync,
    controller: new InternalRegistryController(sync as any, registry),
  };
}

describe('InternalRegistryController', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SAAS_PRIMARY_DOMAIN;
    delete process.env.SAAS_BASE_DOMAINS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('triggers a registry refresh and reports the tenant count + domain config', async () => {
    const { sync, controller } = makeController();
    await expect(controller.refresh()).resolves.toEqual({
      refreshed: true,
      tenants: 2,
      domains: {
        primaryDomain: 'ecomate.bd',
        baseDomains: ['ecomate.bd'],
        source: 'env',
        updatedAt: null,
      },
    });
    expect(sync.refreshNow).toHaveBeenCalledTimes(1);
  });

  it('reports refreshed:false when the sync fails, without throwing', async () => {
    const { controller } = makeController(false);
    await expect(controller.refresh()).resolves.toEqual({
      refreshed: false,
      tenants: 2,
      domains: {
        primaryDomain: 'ecomate.bd',
        baseDomains: ['ecomate.bd'],
        source: 'env',
        updatedAt: null,
      },
    });
  });

  it('is @SkipSubscription: the platform calls it with no tenant host, so the subscription guard would fail the POST closed in production', () => {
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_KEY, [
        InternalRegistryController.prototype.refresh,
        InternalRegistryController,
      ]),
    ).toBe(true);
  });
});
