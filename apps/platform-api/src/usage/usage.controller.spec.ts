import { SetLimitOverrideDto } from './dto/set-limit-override.dto';
import { UsageController } from './usage.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function makeController() {
  const usage: any = {
    overview: jest.fn().mockResolvedValue({ tenants: [] }),
    getTenantUsage: jest.fn().mockResolvedValue({ metrics: [] }),
    refreshTenant: jest.fn().mockResolvedValue({ metrics: [] }),
    refreshAll: jest
      .fn()
      .mockResolvedValue({ total: 0, refreshed: 0, failed: [] }),
    setOverride: jest.fn().mockResolvedValue({ override: {} }),
    clearOverride: jest.fn().mockResolvedValue({ cleared: true }),
  };
  return { usage, controller: new UsageController(usage as any) };
}

describe('UsageController', () => {
  it('lists the cross-tenant overview for the requested window', async () => {
    const { controller, usage } = makeController();

    await controller.overview('14');

    expect(usage.overview).toHaveBeenCalledWith(14);
  });

  it('refreshes one tenant by id', async () => {
    const { controller, usage } = makeController();

    await controller.refreshTenant(TENANT_ID);

    expect(usage.refreshTenant).toHaveBeenCalledWith(TENANT_ID);
  });

  it('passes the acting operator when saving an override', async () => {
    const { controller, usage } = makeController();
    const dto: SetLimitOverrideDto = { value: 500, note: 'negotiated' };

    await controller.setOverride(TENANT_ID, 'products', dto, {
      id: 'admin-1',
    });

    expect(usage.setOverride).toHaveBeenCalledWith(
      TENANT_ID,
      'products',
      dto,
      'admin-1',
    );
  });

  it('passes the acting operator when clearing an override', async () => {
    const { controller, usage } = makeController();

    await controller.clearOverride(TENANT_ID, 'products', { id: 'admin-1' });

    expect(usage.clearOverride).toHaveBeenCalledWith(
      TENANT_ID,
      'products',
      'admin-1',
    );
  });
});
