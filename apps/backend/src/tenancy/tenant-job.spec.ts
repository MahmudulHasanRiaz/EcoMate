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
});
