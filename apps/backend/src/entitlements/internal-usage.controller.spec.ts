import { BadRequestException } from '@nestjs/common';
import { getTenantContext } from '../tenancy/tenant-context';
import { InternalUsageController } from './internal-usage.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function makeController() {
  const limits = {
    getUsageSnapshot: jest.fn().mockImplementation(async () => ({
      planName: 'Growth',
      accessState: 'full',
      limits: [
        {
          key: 'products',
          label: 'Products',
          limit: 10,
          used: 4,
          percent: 40,
          warning: false,
        },
      ],
      context: getTenantContext()?.tenantId ?? null,
    })),
  };
  return {
    limits,
    controller: new InternalUsageController(limits as any),
  };
}

describe('InternalUsageController', () => {
  it('returns live usage inside the requested tenant context', async () => {
    const { controller, limits } = makeController();

    const result = await controller.getUsage({
      tenantId: TENANT_ID,
      slug: 'acme',
    });

    expect(limits.getUsageSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      tenantId: TENANT_ID,
      planName: 'Growth',
      accessState: 'full',
      context: TENANT_ID,
    });
    expect(result.capturedAt).toEqual(expect.any(String));
  });

  it('refuses a request without a tenant id before touching the database', async () => {
    const { controller, limits } = makeController();

    await expect(
      controller.getUsage({ tenantId: '', slug: 'acme' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(limits.getUsageSnapshot).not.toHaveBeenCalled();
  });

  it('refuses a request without a slug', async () => {
    const { controller, limits } = makeController();

    await expect(
      controller.getUsage({ tenantId: TENANT_ID, slug: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(limits.getUsageSnapshot).not.toHaveBeenCalled();
  });

  it('passes a complete window through and echoes it in the response', async () => {
    const { controller, limits } = makeController();

    const result = await controller.getUsage({
      tenantId: TENANT_ID,
      slug: 'acme',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
    });

    expect(limits.getUsageSnapshot).toHaveBeenCalledWith({
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    });
    expect(result.window).toEqual({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
    });
  });

  it('refuses a half-open window (from without to)', async () => {
    const { controller, limits } = makeController();

    await expect(
      controller.getUsage({
        tenantId: TENANT_ID,
        slug: 'acme',
        from: '2026-11-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('from and to must be provided together');
    expect(limits.getUsageSnapshot).not.toHaveBeenCalled();
  });

  it('refuses non-ISO window bounds', async () => {
    const { controller, limits } = makeController();

    await expect(
      controller.getUsage({
        tenantId: TENANT_ID,
        slug: 'acme',
        from: 'not-a-date',
        to: '2026-12-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('from and to must be valid ISO dates');
    expect(limits.getUsageSnapshot).not.toHaveBeenCalled();
  });

  it('refuses an inverted or empty window', async () => {
    const { controller, limits } = makeController();

    await expect(
      controller.getUsage({
        tenantId: TENANT_ID,
        slug: 'acme',
        from: '2026-12-01T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('from must be before to');
    await expect(
      controller.getUsage({
        tenantId: TENANT_ID,
        slug: 'acme',
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('from must be before to');
    expect(limits.getUsageSnapshot).not.toHaveBeenCalled();
  });
});
