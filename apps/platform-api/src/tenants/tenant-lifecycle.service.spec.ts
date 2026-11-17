import {
  BadGatewayException,
  BadRequestException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { EncryptionService } from '../common/encryption.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { ExportProgressRegistry } from './export-progress.registry';

jest.mock('fs/promises', () => ({
  appendFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue('plaintext-export'),
  readdir: jest.fn().mockResolvedValue([]),
  rename: jest.fn().mockResolvedValue(undefined),
  stat: jest
    .fn()
    .mockResolvedValue({ size: 123, isFile: () => true, mtimeMs: Date.now() }),
  unlink: jest.fn().mockResolvedValue(undefined),
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
    signupRequest: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const registry = new ExportProgressRegistry();
  return {
    prisma,
    audit,
    registry,
    service: new TenantLifecycleService(
      prisma as any,
      audit as any,
      undefined,
      registry,
    ),
  };
}

/** Rebuilds the streamed export document from the mocked fs calls. */
function streamedPayload(): any {
  const parts = [
    (writeFile as jest.Mock).mock.calls[0][1],
    ...(appendFile as jest.Mock).mock.calls.map((call) => call[1]),
  ];
  return JSON.parse(parts.join(''));
}

const manifestResponse = (tableOrder: string[] = ['Product']) => ({
  ok: true,
  status: 200,
  json: async () => ({
    tableOrder,
    counts: Object.fromEntries(tableOrder.map((t) => [t, 1])),
    totalRows: tableOrder.length,
  }),
});

const chunkResponse = (rows: unknown[], done = true) => ({
  ok: true,
  status: 200,
  json: async () => ({
    table: 'Product',
    rows,
    nextCursor: null,
    done,
  }),
});

describe('TenantLifecycleService', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.INTERNAL_SERVICE_SECRET = 'secret';
    process.env.TENANT_BACKEND_URL = 'http://backend:4000/api';
    delete process.env.TENANT_RETENTION_DAYS;
    (global as any).fetch = jest.fn();
    for (const fn of [
      appendFile,
      mkdir,
      readFile,
      readdir,
      rename,
      stat,
      unlink,
      writeFile,
    ]) {
      (fn as jest.Mock).mockClear();
    }
    (readdir as jest.Mock).mockResolvedValue([]);
    (readFile as jest.Mock).mockResolvedValue('plaintext-export');
    (stat as jest.Mock).mockResolvedValue({
      size: 123,
      isFile: () => true,
      mtimeMs: Date.now(),
    });
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    delete (global as any).fetch;
  });

  it('triggers the tenant owner password reset without touching the password', async () => {
    const { service, audit } = makeService();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sent: true }),
    });

    const result = await service.resetOwnerPassword('tenant-1', 'admin-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://backend:4000/api/internal/provisioning/owner-password-reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'tenant-1',
          slug: 'acme',
          email: 'owner@example.com',
        }),
      }),
    );
    expect(result).toEqual({ sent: true, email: 'owner@example.com' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.owner_password_reset' }),
    );
  });

  it('reports a reset transport failure', async () => {
    const { service } = makeService();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'down',
    });

    await expect(service.resetOwnerPassword('tenant-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
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

  it('streams a chunked export to a file with progress', async () => {
    const { service, prisma, registry } = makeService();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(chunkResponse([{ id: 'p1' }]));

    const result = await service.exportToFile('tenant-1', 'admin-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://backend:4000/api/internal/provisioning/export/manifest',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-platform-service-token': 'secret',
        }),
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'http://backend:4000/api/internal/provisioning/export/chunk',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"table":"Product"'),
      }),
    );
    expect(prisma.tenant.findUnique).toHaveBeenCalled();
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    expect(rename).toHaveBeenCalled();
    expect(result.filename).toContain('acme-');
    expect(result.filename.endsWith('.json')).toBe(true);
    expect(result.encrypted).toBe(false);
    const payload = streamedPayload();
    expect(payload.platform.slug).toBe('acme');
    expect(payload.tenant.tableOrder).toEqual(['Product']);
    expect(payload.tenant.tables.Product).toEqual([{ id: 'p1' }]);
    const job = registry.runningFor('tenant-1');
    expect(job).toBeUndefined();
  });

  it('follows chunk cursors until the table is done', async () => {
    const { service } = makeService();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          table: 'Product',
          rows: [{ id: 'p1' }],
          nextCursor: '(0,1)',
          done: false,
        }),
      })
      .mockResolvedValueOnce(chunkResponse([{ id: 'p2' }]));

    await service.exportToFile('tenant-1');

    const chunkCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call: any[]) => call[0].endsWith('/export/chunk'),
    );
    expect(chunkCalls).toHaveLength(2);
    expect(JSON.parse(chunkCalls[0][1].body).cursor).toBeNull();
    expect(JSON.parse(chunkCalls[1][1].body).cursor).toBe('(0,1)');
    expect(streamedPayload().tenant.tables.Product).toEqual([
      { id: 'p1' },
      { id: 'p2' },
    ]);
  });

  it('deletes the temp file when a chunk fails', async () => {
    const { service } = makeService();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'boom',
      });

    await expect(service.exportToFile('tenant-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(unlink).toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('joins an in-flight export instead of starting a second one', async () => {
    const { service } = makeService();
    let resolveManifest!: (value: any) => void;
    const manifestPromise = new Promise((res) => {
      resolveManifest = res;
    });
    (global.fetch as jest.Mock)
      .mockReturnValueOnce(manifestPromise)
      .mockResolvedValueOnce(chunkResponse([{ id: 'p1' }]));
    const first = service.exportToFile('tenant-1');
    const second = service.exportToFile('tenant-1');
    resolveManifest(manifestResponse());
    const [a, b] = await Promise.all([first, second]);
    expect(a.filename).toBe(b.filename);
    const manifestCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call: any[]) => call[0].endsWith('/export/manifest'),
    );
    expect(manifestCalls).toHaveLength(1);
  });

  it('starts an async export, tracks progress, and serves the download', async () => {
    const { service, registry } = makeService();
    let resolveManifest!: (value: any) => void;
    const manifestPromise = new Promise((res) => {
      resolveManifest = res;
    });
    (global.fetch as jest.Mock).mockReturnValueOnce(manifestPromise);

    const { jobId } = service.startExport('tenant-1', 'admin-1');
    expect(service.getExportProgress('tenant-1', jobId).status).toBe(
      'running',
    );
    // A second start while running returns the same job.
    expect(service.startExport('tenant-1')).toEqual({ jobId });
    expect(() => service.getExportPath('tenant-1', jobId)).toThrow(
      BadRequestException,
    );
    expect(() => service.getExportProgress('other-tenant', jobId)).toThrow(
      NotFoundException,
    );
    resolveManifest(manifestResponse([]));
    await registry.waitFor(jobId);
    const progress = service.getExportProgress('tenant-1', jobId);
    expect(progress.status).toBe('done');
    expect(progress.tablesTotal).toBe(0);
    const file = service.getExportPath('tenant-1', jobId);
    expect(file.filename).toContain('acme-');
  });

  it('encrypts the export when APP_ENCRYPTION_KEY is configured', async () => {
    const { prisma, audit, registry } = makeService();
    const key = 'ab'.repeat(32);
    process.env.APP_ENCRYPTION_KEY = key;
    const service = new TenantLifecycleService(
      prisma as any,
      audit as any,
      undefined,
      registry,
      new EncryptionService(),
    );
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(chunkResponse([{ id: 'p1' }]));

    const result = await service.exportToFile('tenant-1', 'admin-1');

    expect(result.encrypted).toBe(true);
    expect(result.filename.endsWith('.json.enc')).toBe(true);
    const ciphertext = (writeFile as jest.Mock).mock.calls[1][1] as string;
    expect(ciphertext.startsWith('enc:v1:')).toBe(true);
    expect(new EncryptionService().decrypt(ciphertext)).toBe(
      'plaintext-export',
    );
    expect(unlink).toHaveBeenCalled();
  });

  it('prunes export files older than the retention window', async () => {
    const { service } = makeService();
    const now = Date.now();
    (readdir as jest.Mock).mockResolvedValue([
      'acme-old.json',
      'acme-new.json',
      'acme-old.json.enc',
      'notes.txt',
      '.acme-x.json.tmp-1',
    ]);
    (stat as jest.Mock).mockImplementation(async (path: string) => {
      const old = path.includes('-old.');
      return {
        size: 10,
        isFile: () => true,
        mtimeMs: old ? now - 100 * DAY : now - DAY,
      };
    });

    const result = await service.runExportRetentionSweep(now);

    expect(result).toEqual({ deleted: 2, bytesFreed: 20 });
    const unlinked = (unlink as jest.Mock).mock.calls.map(
      (call) => call[0] as string,
    );
    expect(unlinked.some((p) => p.endsWith('acme-old.json'))).toBe(true);
    expect(unlinked.some((p) => p.endsWith('acme-old.json.enc'))).toBe(true);
    expect(unlinked.some((p) => p.endsWith('acme-new.json'))).toBe(false);
    expect(unlinked.some((p) => p.endsWith('notes.txt'))).toBe(false);
  });

  it('returns zero when the export dir does not exist yet', async () => {
    const { service } = makeService();
    (readdir as jest.Mock).mockRejectedValue(
      Object.assign(new Error('no dir'), { code: 'ENOENT' }),
    );
    await expect(service.runExportRetentionSweep()).resolves.toEqual({
      deleted: 0,
      bytesFreed: 0,
    });
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
      .mockResolvedValueOnce(manifestResponse([]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          deletedRows: 7,
          mediaDeletedFiles: 3,
          mediaFailedFiles: [],
          jobsRemoved: 2,
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await service.purgeNow('tenant-1', 'admin-1');

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(
      'http://backend:4000/api/internal/provisioning/purge',
    );
    // Third call: the registry-refresh push so the backend stops routing
    // the purged tenant without waiting for the 60s poll.
    expect((global.fetch as jest.Mock).mock.calls[2]).toEqual([
      'http://backend:4000/api/internal/tenants/registry/refresh',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-platform-service-token': 'secret',
        }),
      }),
    ]);
    expect(prisma.tenant.delete).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
    });
    expect(result.deletedRows).toBe(7);
    expect(result.mediaDeletedFiles).toBe(3);
    expect(result.jobsRemoved).toBe(2);
    expect(result.exportFilename).toContain('acme-');
  });

  it('deletes the orphan signup request so the owner email can re-sign up', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      status: 'DELETED',
      deletedAt: new Date(Date.now() - 31 * DAY),
    });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(manifestResponse([]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          deletedRows: 7,
          mediaDeletedFiles: 0,
          mediaFailedFiles: [],
          jobsRemoved: 0,
        }),
      });

    const result = await service.purgeNow('tenant-1', 'admin-1');

    // The request has no FK to the tenant and stays VERIFIED forever; a
    // leftover request blocks re-signup for the same email/slug.
    expect(prisma.signupRequest.deleteMany).toHaveBeenCalledWith({
      where: { slug: tenant.slug },
    });
    expect(result.signupRequestsDeleted).toBe(1);
  });

  it('still purges when the registry-refresh push fails', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      status: 'DELETED',
      deletedAt: new Date(Date.now() - 31 * DAY),
    });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(manifestResponse([]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          deletedRows: 7,
          mediaDeletedFiles: 0,
          mediaFailedFiles: [],
          jobsRemoved: 0,
        }),
      })
      .mockRejectedValueOnce(new Error('backend unreachable'));

    const result = await service.purgeNow('tenant-1', 'admin-1');

    expect(prisma.tenant.delete).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
    });
    expect(result.deletedRows).toBe(7);
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

    expect(result).toEqual({ purged: 0, failed: 0, exportsPruned: 0 });
    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'DELETED', deletedAt: { lte: expect.any(Date) } },
      }),
    );
  });

  it('alerts ops once per sweep when purges fail (Phase 8 item 20)', async () => {
    const { prisma, audit } = makeService();
    const alerts = {
      sendAlert: jest.fn().mockResolvedValue({ sent: true }),
    } as any;
    const service = new TenantLifecycleService(
      prisma as any,
      audit as any,
      alerts,
    );
    prisma.tenant.findMany.mockResolvedValue([
      { ...tenant, status: 'DELETED', deletedAt: new Date(Date.now() - 31 * DAY) },
    ]);
    // Export fails (backend unreachable) -> purge aborts -> sweep failure.
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error('backend down'),
    );

    const result = await service.runPurgeSweep(Date.now());

    expect(result).toEqual({ purged: 0, failed: 1, exportsPruned: 0 });
    expect(alerts.sendAlert).toHaveBeenCalledTimes(1);
    expect(alerts.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'purge-sweep-failure',
        subject: expect.stringContaining('failed for 1 tenant(s)'),
      }),
    );
  });

  it('does not alert when the sweep fully succeeds', async () => {
    const { prisma, audit } = makeService();
    const alerts = {
      sendAlert: jest.fn().mockResolvedValue({ sent: true }),
    } as any;
    const service = new TenantLifecycleService(
      prisma as any,
      audit as any,
      alerts,
    );
    prisma.tenant.findMany.mockResolvedValue([]);
    const result = await service.runPurgeSweep(Date.now());
    expect(result).toEqual({ purged: 0, failed: 0, exportsPruned: 0 });
    expect(alerts.sendAlert).not.toHaveBeenCalled();
  });
});
