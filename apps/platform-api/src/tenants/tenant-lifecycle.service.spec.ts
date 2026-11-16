import { BadGatewayException, GoneException } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { TenantLifecycleService } from './tenant-lifecycle.service';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

const DAY = 86_400_000;
const tenant = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme',
  status: 'ACTIVE',
  ownerEmail: 'owner@example.com',
  trialEndsAt: new Date(Date.now() + 5 * DAY),
  deletedAt: null,
  suspendedAt: null,
  domains: [],
  planVersion: null,
  subscription: null,
  invoices: [],
  paymentProofs: [],
  payments: [],
  creditNotes: [],
  couponRedemptions: [],
  usage: [],
  impersonations: [],
  provisioningJobs: [],
  auditLogs: [],
};

function makeService() {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(tenant),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        ...tenant,
        ...data,
      })),
      delete: jest.fn().mockResolvedValue(tenant),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    audit,
    service: new TenantLifecycleService(prisma as any, audit as any),
  };
}

describe('TenantLifecycleService', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.INTERNAL_SERVICE_SECRET = 'secret';
    process.env.TENANT_BACKEND_URL = 'http://backend:4000/api';
    delete process.env.TENANT_RETENTION_DAYS;
    (global as any).fetch = jest.fn();
    (mkdir as jest.Mock).mockClear();
    (writeFile as jest.Mock).mockClear();
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    delete (global as any).fetch;
  });

  it('soft-deletes with a 30-day purge deadline', async () => {
    const { service, prisma, audit } = makeService();

    const result = await service.softDelete('tenant-1', 'admin-1');

    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: expect.objectContaining({
        status: 'DELETED',
        deletedAt: expect.any(Date),
        suspendedAt: null,
      }),
    });
    expect(result.status).toBe('DELETED');
    expect(result.retentionDays).toBe(30);
    expect(result.purgeAfter.getTime()).toBeGreaterThan(
      result.deletedAt.getTime(),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.soft_delete' }),
    );
  });

  it('restores inside the retention window and refuses after it', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      status: 'DELETED',
      deletedAt: new Date(Date.now() - 2 * DAY),
    });

    const restored = await service.restore('tenant-1', 'admin-1');
    expect(restored.status).toBe('TRIAL');

    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      status: 'DELETED',
      deletedAt: new Date(Date.now() - 31 * DAY),
    });
    await expect(service.restore('tenant-1')).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('exports platform and tenant data to a file', async () => {
    const { service, prisma } = makeService();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tables: { Product: [{ id: 'p1' }] } }),
    });

    const result = await service.exportToFile('tenant-1', 'admin-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://backend:4000/api/internal/provisioning/export',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-platform-service-token': 'secret',
        }),
      }),
    );
    expect(prisma.tenant.findUnique).toHaveBeenCalled();
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    expect(result.filename).toContain('acme-');
    const payload = JSON.parse((writeFile as jest.Mock).mock.calls[0][1]);
    expect(payload.platform.slug).toBe('acme');
    expect(payload.tenant.tables.Product).toEqual([{ id: 'p1' }]);
  });

  it('does not purge when the tenant export fails', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      status: 'DELETED',
      deletedAt: new Date(Date.now() - 31 * DAY),
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });

    await expect(service.purgeNow('tenant-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(prisma.tenant.delete).not.toHaveBeenCalled();
  });

  it('exports then purges tenant data and removes the platform row', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      status: 'DELETED',
      deletedAt: new Date(Date.now() - 31 * DAY),
    });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tables: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ deletedRows: 7 }),
      });

    const result = await service.purgeNow('tenant-1', 'admin-1');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(
      'http://backend:4000/api/internal/provisioning/purge',
    );
    expect(prisma.tenant.delete).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
    });
    expect(result.deletedRows).toBe(7);
    expect(result.exportFilename).toContain('acme-');
  });

  it('refuses an early purge inside retention', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      status: 'DELETED',
      deletedAt: new Date(Date.now() - 2 * DAY),
    });

    await expect(service.purgeNow('tenant-1')).rejects.toThrow(
      'Retention window',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sweeps only tenants past retention', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findMany.mockResolvedValue([]);

    const result = await service.runPurgeSweep(Date.now());

    expect(result).toEqual({ purged: 0, failed: 0 });
    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'DELETED', deletedAt: { lte: expect.any(Date) } },
      }),
    );
  });
});
