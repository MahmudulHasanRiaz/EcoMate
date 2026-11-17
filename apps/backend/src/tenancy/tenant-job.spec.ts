import { Logger } from '@nestjs/common';
import { TenantRegistryService } from './tenant-registry.service';
import { getTenantContext, runWithTenant } from './tenant-context';
import {
  runPerTenant,
  tenantJobPayload,
  TenantWorkerHost,
} from './tenant-job';

class TestWorker extends TenantWorkerHost<{ tenantId: string; value: string }> {
  seen: string | undefined;

  protected async handle(job: any): Promise<unknown> {
    this.seen = getTenantContext()?.tenantId;
    return job.data.value;
  }
}

describe('tenant jobs', () => {
  const ctx = { tenantId: '11111111-1111-4111-8111-111111111111', slug: 'alpha' };

  it('stamps the current tenant onto a payload', () => {
    const data = runWithTenant(ctx, () =>
      tenantJobPayload({ hello: 'world' }),
    );
    expect(data).toEqual({
      hello: 'world',
      tenantId: ctx.tenantId,
      tenantSlug: ctx.slug,
    });
  });

  it('runs a worker inside the job tenant context', async () => {
    const worker = new TestWorker();
    const result = await worker.process({
      name: 'send',
      id: 'j1',
      data: { tenantId: ctx.tenantId, tenantSlug: ctx.slug, value: 'ok' },
    } as any);
    expect(result).toBe('ok');
    expect(worker.seen).toBe(ctx.tenantId);
  });

  it('fails closed in production when a job has no tenantId', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const worker = new TestWorker();
      await expect(
        worker.process({ name: 'send', id: 'j2', data: { value: 'x' } } as any),
      ).rejects.toThrow(/missing tenantId/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('skips an old job for a tenant that vanished from the registry', async () => {
    const registry = new TenantRegistryService();
    registry.replace([
      { id: 'other', slug: 'other', status: 'ACTIVE', hosts: [] },
    ]);
    const worker = new TestWorker(registry);
    const result = await worker.process({
      name: 'send',
      id: 'j-old',
      timestamp: Date.now() - 60 * 60_000,
      data: { tenantId: ctx.tenantId, tenantSlug: ctx.slug, value: 'ok' },
    } as any);
    expect(result).toEqual({
      skipped: 'tenant-unknown-or-deleted',
      tenantId: ctx.tenantId,
    });
    expect(worker.seen).toBeUndefined();
  });

  it('skips a job for a tenant listed as DELETED', async () => {
    const registry = new TenantRegistryService();
    registry.replace([
      { id: ctx.tenantId, slug: ctx.slug, status: 'DELETED', hosts: [] },
    ]);
    const worker = new TestWorker(registry);
    const result = await worker.process({
      name: 'send',
      id: 'j-deleted',
      timestamp: Date.now(),
      data: { tenantId: ctx.tenantId, tenantSlug: ctx.slug, value: 'ok' },
    } as any);
    expect(result).toEqual({
      skipped: 'tenant-unknown-or-deleted',
      tenantId: ctx.tenantId,
    });
    expect(worker.seen).toBeUndefined();
  });

  it('runs a young job for an unknown tenant (registry sync lag)', async () => {
    const registry = new TenantRegistryService();
    registry.replace([
      { id: 'other', slug: 'other', status: 'ACTIVE', hosts: [] },
    ]);
    const worker = new TestWorker(registry);
    const result = await worker.process({
      name: 'send',
      id: 'j-young',
      timestamp: Date.now() - 60_000,
      data: { tenantId: ctx.tenantId, tenantSlug: ctx.slug, value: 'ok' },
    } as any);
    expect(result).toBe('ok');
    expect(worker.seen).toBe(ctx.tenantId);
  });

  it('runs the job when the registry is empty (cold start fails open)', async () => {
    const registry = new TenantRegistryService();
    const worker = new TestWorker(registry);
    const result = await worker.process({
      name: 'send',
      id: 'j-cold',
      timestamp: Date.now() - 60 * 60_000,
      data: { tenantId: ctx.tenantId, tenantSlug: ctx.slug, value: 'ok' },
    } as any);
    expect(result).toBe('ok');
    expect(worker.seen).toBe(ctx.tenantId);
  });

  it('runs the job when no registry is injected', async () => {
    const worker = new TestWorker();
    const result = await worker.process({
      name: 'send',
      id: 'j-noreg',
      timestamp: Date.now() - 60 * 60_000,
      data: { tenantId: ctx.tenantId, tenantSlug: ctx.slug, value: 'ok' },
    } as any);
    expect(result).toBe('ok');
    expect(worker.seen).toBe(ctx.tenantId);
  });

  it('runs a sweep per active tenant and isolates failures', async () => {
    const registry = new TenantRegistryService();
    registry.replace([
      { id: 'a', slug: 'alpha', status: 'active', hosts: [] },
      { id: 'b', slug: 'beta', status: 'active', hosts: [] },
      { id: 'c', slug: 'closed', status: 'suspended', hosts: [] },
    ]);
    const seen: string[] = [];
    const failures: string[] = [];
    const result = await runPerTenant(
      registry,
      async (tenant) => {
        seen.push(tenant.id);
        if (tenant.id === 'b') throw new Error('boom');
      },
      (tenantId) => failures.push(tenantId),
    );
    expect(seen.sort()).toEqual(['a', 'b']);
    expect(failures).toEqual(['b']);
    expect(result).toEqual({ succeeded: 1, failed: 1 });
  });

  it('processes UPPERCASE ACTIVE tenants from the platform registry', async () => {
    // Regression: the platform TenantStatus enum is UPPERCASE and the
    // registry sync copies it verbatim, so a lowercase 'active' filter
    // silently processed zero tenants in production.
    const registry = new TenantRegistryService();
    registry.replace([
      { id: 'a', slug: 'alpha', status: 'ACTIVE', hosts: [] },
      { id: 'b', slug: 'beta', status: 'ACTIVE', hosts: [] },
      { id: 'c', slug: 'closed', status: 'SUSPENDED', hosts: [] },
      { id: 'd', slug: 'trial', status: 'TRIAL', hosts: [] },
      { id: 'e', slug: 'due', status: 'PAST_DUE', hosts: [] },
      { id: 'f', slug: 'gone', status: 'DELETED', hosts: [] },
    ]);
    const seen: string[] = [];
    const result = await runPerTenant(registry, async (tenant) => {
      seen.push(tenant.id);
    });
    expect(seen.sort()).toEqual(['a', 'b']);
    expect(result).toEqual({ succeeded: 2, failed: 0 });
  });

  it('still matches a lowercase active status (defensive)', async () => {
    const registry = new TenantRegistryService();
    registry.replace([
      { id: 'a', slug: 'alpha', status: 'active', hosts: [] },
    ]);
    const seen: string[] = [];
    await runPerTenant(registry, async (tenant) => {
      seen.push(tenant.id);
    });
    expect(seen).toEqual(['a']);
  });

  it('warns loudly when a sweep finds zero ACTIVE tenants', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    try {
      const registry = new TenantRegistryService();
      registry.replace([
        { id: 'c', slug: 'closed', status: 'SUSPENDED', hosts: [] },
      ]);
      const seen: string[] = [];
      await runPerTenant(registry, async (tenant) => {
        seen.push(tenant.id);
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('0 ACTIVE tenants'),
      );
      // The dev/test fallback still runs the sweep for the default tenant,
      // but the zero-registry warning above must fire regardless.
      expect(debug).toHaveBeenCalledWith(
        expect.stringContaining('sweeping 1 tenant(s)'),
      );
      expect(seen).toHaveLength(1);
    } finally {
      warn.mockRestore();
      debug.mockRestore();
    }
  });

  it('logs the per-sweep tenant count', async () => {
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    try {
      const registry = new TenantRegistryService();
      registry.replace([
        { id: 'a', slug: 'alpha', status: 'ACTIVE', hosts: [] },
        { id: 'b', slug: 'beta', status: 'ACTIVE', hosts: [] },
      ]);
      await runPerTenant(registry, async () => {});
      expect(debug).toHaveBeenCalledWith(
        expect.stringContaining('sweeping 2 tenant(s)'),
      );
      expect(debug).toHaveBeenCalledWith(
        expect.stringContaining('sweep complete — 2 succeeded, 0 failed'),
      );
    } finally {
      debug.mockRestore();
    }
  });
});
