import { runWithTenant } from '../tenancy/tenant-context';
import { TenantDomainsController } from './tenant-domains.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function makeController() {
  const service = {
    list: jest.fn().mockResolvedValue([]),
    add: jest.fn().mockResolvedValue({ domain: { id: 'd1' }, dns: null }),
    recheck: jest.fn().mockResolvedValue({ verified: true }),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
  };
  return {
    service,
    controller: new TenantDomainsController(service as any),
  };
}

/** Run a controller call inside the tenant context, as the middleware does. */
function asTenant<T>(fn: () => T): T {
  return runWithTenant({ tenantId: TENANT_ID, slug: 'mystore' }, fn);
}

describe('TenantDomainsController', () => {
  it('lists with the tenant id from context, never the request', async () => {
    const { controller, service } = makeController();
    await asTenant(() => controller.list());
    expect(service.list).toHaveBeenCalledWith(TENANT_ID);
  });

  it('adds with the tenant id from context and the dto host', async () => {
    const { controller, service } = makeController();
    await asTenant(() =>
      controller.add({ host: 'shop.example.com' }),
    );
    expect(service.add).toHaveBeenCalledWith(TENANT_ID, 'shop.example.com');
  });

  it('rechecks and removes with the tenant id from context', async () => {
    const { controller, service } = makeController();
    await asTenant(() => controller.recheck('domain-9'));
    expect(service.recheck).toHaveBeenCalledWith(TENANT_ID, 'domain-9');
    await asTenant(() => controller.remove('domain-9'));
    expect(service.remove).toHaveBeenCalledWith(TENANT_ID, 'domain-9');
  });

  it('fails closed without a tenant context', () => {
    const { controller, service } = makeController();
    // requireTenantId() throws synchronously, before the service is touched.
    expect(() => controller.list()).toThrow('Tenant context is required');
    expect(service.list).not.toHaveBeenCalled();
  });
});
