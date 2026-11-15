import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithTenant } from '../tenant-context';
import { TenantPrismaManager } from '../tenant-prisma.manager';

/**
 * Real-DB proof that the request proxy + PostgreSQL RLS isolate two tenants.
 * Requires a migrated tenant database; see docs/saas/tenant-test-db.md.
 */
describe('tenant runtime isolation (proxy + RLS)', () => {
  const manager = new TenantPrismaManager();
  const prisma = new PrismaService(manager);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const key = `rls-isolation-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const ctx = (tenantId: string) => ({
    tenantId,
    slug: `t-${tenantId.slice(0, 8)}`,
    status: 'active',
  });

  afterAll(async () => {
    await runWithTenant(ctx(tenantA), () =>
      prisma.systemSetting.deleteMany({ where: { key } }),
    ).catch(() => undefined);
    await runWithTenant(ctx(tenantB), () =>
      prisma.systemSetting.deleteMany({ where: { key } }),
    ).catch(() => undefined);
    manager.onModuleDestroy();
  });

  it('creates and reads the same key independently per tenant', async () => {
    const a = await runWithTenant(ctx(tenantA), () =>
      prisma.systemSetting.create({ data: { key, value: 'A' } }),
    );
    const b = await runWithTenant(ctx(tenantB), () =>
      prisma.systemSetting.create({ data: { key, value: 'B' } }),
    );

    expect(a.tenantId).toBe(tenantA);
    expect(b.tenantId).toBe(tenantB);

    const aRead = await runWithTenant(ctx(tenantA), () =>
      prisma.systemSetting.findMany({ where: { key } }),
    );
    const bRead = await runWithTenant(ctx(tenantB), () =>
      prisma.systemSetting.findMany({ where: { key } }),
    );

    expect(aRead).toHaveLength(1);
    expect(aRead[0].value).toBe('A');
    expect(bRead).toHaveLength(1);
    expect(bRead[0].value).toBe('B');
  });

  it('cannot read or mutate another tenant row even with an explicit where', async () => {
    const crossRead = await runWithTenant(ctx(tenantA), () =>
      prisma.systemSetting.findFirst({
        where: { tenantId: tenantB, key },
      }),
    );
    expect(crossRead).toBeNull();

    const crossDelete = await runWithTenant(ctx(tenantA), () =>
      prisma.systemSetting.deleteMany({
        where: { tenantId: tenantB, key },
      }),
    );
    expect(crossDelete.count).toBe(0);

    const bRead = await runWithTenant(ctx(tenantB), () =>
      prisma.systemSetting.findFirst({ where: { key } }),
    );
    expect(bRead?.value).toBe('B');
  });
});
