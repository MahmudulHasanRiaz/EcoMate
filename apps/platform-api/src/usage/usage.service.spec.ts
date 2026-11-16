import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { UsageService } from './usage.service';
import { dhakaDateOnly } from './usage.limits';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ORIGINAL_ENV = { ...process.env };
const originalFetch = global.fetch;

function makeTenant(overrides: any = {}) {
  const planVersion = {
    limits: { products: 100, staff_users: 5 },
    plan: { name: 'Growth' },
  };
  return {
    id: TENANT_ID,
    slug: 'acme',
    name: 'Acme',
    status: 'ACTIVE',
    planVersion,
    subscription: { planVersion },
    limitOverrides: [
      {
        key: 'products',
        value: 250,
        note: 'negotiated',
        updatedAt: new Date('2026-11-15T10:00:00.000Z'),
      },
    ],
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(makeTenant()),
      findMany: jest.fn().mockResolvedValue([makeTenant()]),
    },
    usageDaily: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    tenantLimitOverride: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
        id: 'override-1',
        ...create,
      })),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { prisma, audit, service: new UsageService(prisma, audit) };
}

function storedRow(metric: string, value: number, date = new Date()) {
  return {
    tenantId: TENANT_ID,
    metric,
    value,
    date: dhakaDateOnly(date),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.TENANT_BACKEND_URL = 'http://tenant.test/api';
  process.env.INTERNAL_SERVICE_SECRET = 'service-secret';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('UsageService.refreshTenant', () => {
  it('pulls the tenant counters with the service token and snapshots every metric for the Dhaka day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-16T18:30:00.000Z'));
    const { service, prisma } = makeService();
    const payload = {
      capturedAt: '2026-11-16T18:30:00.000Z',
      limits: [
        { key: 'products', used: 4 },
        { key: 'staff_users', used: 2 },
        { key: 'orders_per_month', used: 10 },
        { key: 'storage_mb', used: 45 },
      ],
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    global.fetch = fetchMock as any;

    prisma.usageDaily.findMany.mockResolvedValue([
      storedRow('products', 4),
      storedRow('staff_users', 2),
      storedRow('orders_per_month', 10),
      storedRow('storage_mb', 45),
    ]);

    const result = await service.refreshTenant(TENANT_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `http://tenant.test/api/internal/usage?tenantId=${TENANT_ID}&slug=acme`,
      expect.objectContaining({
        headers: { 'x-platform-service-token': 'service-secret' },
      }),
    );
    expect(prisma.usageDaily.upsert).toHaveBeenCalledTimes(4);
    expect(prisma.usageDaily.upsert).toHaveBeenCalledWith({
      where: {
        tenantId_date_metric: {
          tenantId: TENANT_ID,
          date: new Date('2026-11-17T00:00:00.000Z'),
          metric: 'products',
        },
      },
      create: expect.objectContaining({ metric: 'products', value: 4 }),
      update: { value: 4 },
    });

    expect(result.metrics[0]).toMatchObject({
      key: 'products',
      planLimit: 100,
      override: 250,
      limit: 250,
      used: 4,
      percent: 2,
      over: false,
    });
    expect(result.planName).toBe('Growth');
  });

  it('does not snapshot keys the tenant did not report', async () => {
    const { service, prisma } = makeService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ limits: [{ key: 'products', used: 1 }] }),
    }) as any;

    await service.refreshTenant(TENANT_ID);

    expect(prisma.usageDaily.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.usageDaily.upsert.mock.calls[0][0].create.metric).toBe(
      'products',
    );
  });

  it('fails truthfully and writes nothing when the tenant backend is down', async () => {
    const { service, prisma } = makeService();
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED')) as any;

    await expect(service.refreshTenant(TENANT_ID)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(prisma.usageDaily.upsert).not.toHaveBeenCalled();
  });

  it('fails truthfully on a non-2xx tenant response', async () => {
    const { service, prisma } = makeService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    }) as any;

    await expect(service.refreshTenant(TENANT_ID)).rejects.toThrow(
      /HTTP 503/,
    );
    expect(prisma.usageDaily.upsert).not.toHaveBeenCalled();
  });

  it('fails truthfully when the payload has no usage rows', async () => {
    const { service } = makeService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ limits: [] }),
    }) as any;

    await expect(service.refreshTenant(TENANT_ID)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('refuses to run without the service secret instead of sending an unauthenticated call', async () => {
    const { service } = makeService();
    delete process.env.INTERNAL_SERVICE_SECRET;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    await expect(service.refreshTenant(TENANT_ID)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('UsageService.getTenantUsage', () => {
  it('keeps the latest snapshot per metric and exposes history', async () => {
    const { prisma, service } = makeService();
    prisma.usageDaily.findMany.mockResolvedValue([
      storedRow('products', 3, new Date('2026-11-14T10:00:00.000Z')),
      storedRow('products', 4, new Date('2026-11-15T10:00:00.000Z')),
      storedRow('orders_per_month', 12, new Date('2026-11-15T10:00:00.000Z')),
    ]);

    const result = await service.getTenantUsage(TENANT_ID, 30);

    const products = result.metrics.find((row) => row.key === 'products')!;
    expect(products).toMatchObject({
      used: 4,
      limit: 250,
      percent: 2,
      warning: false,
      over: false,
    });
    expect(result.history.products).toEqual([
      { date: '2026-11-14', value: 3 },
      { date: '2026-11-15', value: 4 },
    ]);
    expect(
      result.metrics.find((row) => row.key === 'staff_users')?.used,
    ).toBeNull();
  });

  it('flags over-limit and warning metrics against the effective limit', async () => {
    const { prisma, service } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(
      makeTenant({
        limitOverrides: [
          {
            key: 'products',
            value: 3,
            note: null,
            updatedAt: new Date('2026-11-15T10:00:00.000Z'),
          },
        ],
      }),
    );
    prisma.usageDaily.findMany.mockResolvedValue([storedRow('products', 4)]);

    const result = await service.getTenantUsage(TENANT_ID, 30);
    const products = result.metrics.find((row) => row.key === 'products')!;
    expect(products).toMatchObject({
      limit: 3,
      used: 4,
      percent: 133,
      over: true,
      warning: true,
    });
  });

  it('returns a 404 for an unknown tenant', async () => {
    const { prisma, service } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(service.getTenantUsage(TENANT_ID, 30)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('UsageService.overview', () => {
  it('reports tracked, missing, warning and over-limit tenants from stored snapshots', async () => {
    const { prisma, service } = makeService();
    const second = makeTenant({
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'beta',
      name: 'Beta',
      limitOverrides: [],
    });
    prisma.tenant.findMany.mockResolvedValue([makeTenant(), second]);
    prisma.usageDaily.findMany.mockResolvedValue([
      storedRow('products', 260),
      storedRow('staff_users', 4),
      storedRow('orders_per_month', 8),
    ]);

    const result = await service.overview(30);

    expect(result.totals).toEqual({
      tenants: 2,
      tracked: 1,
      missing: 1,
      overLimitMetrics: 1,
      warningMetrics: 1,
    });
    expect(result.tenants[0]).toMatchObject({
      slug: 'acme',
      over: true,
      lastCollectedAt: expect.any(String),
    });
    expect(result.tenants[0].metrics[0]).toMatchObject({
      key: 'products',
      used: 260,
      limit: 250,
      over: true,
    });
    expect(result.tenants[1].metrics[0].used).toBeNull();
  });

  it('uses the newest snapshot when several days are stored', async () => {
    const { prisma, service } = makeService();
    prisma.usageDaily.findMany.mockResolvedValue([
      storedRow('products', 9, new Date()),
      storedRow('products', 2, new Date('2026-11-01T00:00:00.000Z')),
    ]);

    const result = await service.overview(30);

    expect(result.tenants[0].metrics[0].used).toBe(9);
  });
});

describe('UsageService limit overrides', () => {
  it('rejects an unknown limit key', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.setOverride(TENANT_ID, 'seats', { value: 3 }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tenantLimitOverride.upsert).not.toHaveBeenCalled();
  });

  it('rejects a negative or non-numeric override value', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.setOverride(TENANT_ID, 'products', { value: -1 }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tenantLimitOverride.upsert).not.toHaveBeenCalled();
  });

  it('upserts the override, audits it and pushes a registry refresh', async () => {
    const { service, prisma, audit } = makeService();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ refreshed: true }),
    });
    global.fetch = fetchMock as any;

    const result = await service.setOverride(
      TENANT_ID,
      'products',
      { value: 500, note: 'negotiated' },
      'admin-1',
    );

    expect(prisma.tenantLimitOverride.upsert).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: TENANT_ID, key: 'products' } },
      create: expect.objectContaining({
        tenantId: TENANT_ID,
        key: 'products',
        value: 500,
        note: 'negotiated',
        createdBy: 'admin-1',
      }),
      update: expect.objectContaining({ value: 500, updatedBy: 'admin-1' }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.limit_override.set',
        tenantId: TENANT_ID,
        after: expect.objectContaining({ key: 'products', value: 500 }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://tenant.test/api/entitlements/refresh',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-platform-service-token': 'service-secret' },
      }),
    );
    expect(result.refresh).toMatchObject({ ok: true });
  });

  it('keeps the override when the tenant refresh push fails, and discloses it', async () => {
    const { service, prisma } = makeService();
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED')) as any;

    const result = await service.setOverride(
      TENANT_ID,
      'products',
      { value: 500 },
      'admin-1',
    );

    expect(prisma.tenantLimitOverride.upsert).toHaveBeenCalled();
    expect(result.refresh).toMatchObject({
      ok: false,
      error: expect.stringContaining('ECONNREFUSED'),
    });
  });

  it('clears an existing override and restores the plan value', async () => {
    const { service, prisma, audit } = makeService();
    prisma.tenantLimitOverride.findUnique.mockResolvedValue({
      id: 'override-1',
      tenantId: TENANT_ID,
      key: 'products',
      value: 500,
      note: 'negotiated',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ refreshed: true }),
    }) as any;

    const result = await service.clearOverride(
      TENANT_ID,
      'products',
      'admin-1',
    );

    expect(prisma.tenantLimitOverride.delete).toHaveBeenCalledWith({
      where: { id: 'override-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.limit_override.clear',
        before: expect.objectContaining({ value: 500 }),
      }),
    );
    expect(result.cleared).toBe(true);
  });

  it('returns a 404 when clearing a key that has no override', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.clearOverride(TENANT_ID, 'products', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tenantLimitOverride.delete).not.toHaveBeenCalled();
  });

  it('returns a 404 when setting an override on an unknown tenant', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(
      service.setOverride(TENANT_ID, 'products', { value: 5 }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsageService.refreshAll', () => {
  it('continues after a tenant failure and reports both outcomes', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findMany.mockResolvedValue([
      { id: TENANT_ID },
      { id: '22222222-2222-4222-8222-222222222222' },
    ]);
    jest
      .spyOn(service, 'refreshTenant')
      .mockResolvedValueOnce({ metrics: [] } as any)
      .mockRejectedValueOnce(new Error('tenant offline'));

    const result = await service.refreshAll();

    expect(result).toEqual({
      total: 2,
      refreshed: 1,
      failed: [
        {
          tenantId: '22222222-2222-4222-8222-222222222222',
          error: 'tenant offline',
        },
      ],
    });
  });
});
