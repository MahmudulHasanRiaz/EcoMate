// Phase 3 central-auth cutover — the ONE permission loader (plan §5 R-8).
// The loader unifies the three former call sites: one DB re-read per
// call via the injected tenant PrismaService (never the session object),
// DB errors PROPAGATE (callers decide the failure policy).
import { loadEffectivePermissions } from './permissions-loader';
import { getAllPermissions } from './registry';

function makePrisma(overrides: {
  baUser?: { override_permissions?: unknown; denied_permissions?: unknown } | null;
  employee?: { accessPresetId?: string | null; accessPreset?: { permissions: unknown } | null } | null;
  baError?: Error;
  employeeError?: Error;
} = {}) {
  return {
    betterAuthUser: {
      findFirst: jest.fn(async () => {
        if (overrides.baError) throw overrides.baError;
        return overrides.baUser ?? null;
      }),
    },
    employee: {
      findFirst: jest.fn(async () => {
        if (overrides.employeeError) throw overrides.employeeError;
        return overrides.employee ?? null;
      }),
    },
  };
}

describe('loadEffectivePermissions (the ONE loader)', () => {
  it('superadmin is always all-open with no DB calls', async () => {
    const prisma = makePrisma();
    const perms = await loadEffectivePermissions(prisma, {
      role: 'superadmin',
      betterAuthUserId: 'ba-1',
    });
    expect(perms).toEqual(getAllPermissions());
    expect(prisma.betterAuthUser.findFirst).not.toHaveBeenCalled();
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('customer gets [] with no DB calls', async () => {
    const prisma = makePrisma();
    const perms = await loadEffectivePermissions(prisma, {
      role: 'customer',
      betterAuthUserId: 'ba-1',
    });
    expect(perms).toEqual([]);
    expect(prisma.betterAuthUser.findFirst).not.toHaveBeenCalled();
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('no BA link falls back to role defaults with no DB calls', async () => {
    const prisma = makePrisma();
    const perms = await loadEffectivePermissions(prisma, {
      role: 'employee',
      betterAuthUserId: null,
    });
    expect(perms).toEqual([
      'view_media',
      'view_customer_reviews',
      'approve_customer_reviews',
      'view_cod_mismatch',
    ]);
    expect(prisma.betterAuthUser.findFirst).not.toHaveBeenCalled();
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('reads overrides from the BA row and the preset DIRECTLY from the Employee table (not through the BA relation)', async () => {
    const prisma = makePrisma({
      baUser: { override_permissions: ['view_orders'], denied_permissions: [] },
      employee: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_customers'] },
      },
    });
    const perms = await loadEffectivePermissions(prisma, {
      role: 'employee',
      betterAuthUserId: 'ba-1',
    });
    expect(prisma.betterAuthUser.findFirst).toHaveBeenCalledWith({
      where: { id: 'ba-1' },
      select: {
        override_permissions: true,
        denied_permissions: true,
      },
    });
    expect(prisma.employee.findFirst).toHaveBeenCalledWith({
      where: { betterAuthUserId: 'ba-1' },
      include: { accessPreset: true },
    });
    expect(perms).toEqual(['view_customers', 'view_orders']);
  });

  it('denied permissions are removed from the granted set', async () => {
    const prisma = makePrisma({
      baUser: {
        override_permissions: ['view_orders'],
        denied_permissions: ['view_customers'],
      },
      employee: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_customers', 'view_products'] },
      },
    });
    const perms = await loadEffectivePermissions(prisma, {
      role: 'employee',
      betterAuthUserId: 'ba-1',
    });
    expect(perms).toEqual(['view_products', 'view_orders']);
  });

  it("JUDGEMENT CALL (effective-permissions.ts:131-133): an admin's override alone does NOT count as a preset in use — admin stays all-open", async () => {
    // Legacy admin rows carry stray overrides (the old user dialog wrote
    // them as no-op extras). Treating override-alone as a preset would
    // silently strip such an admin down to that list on deploy.
    const prisma = makePrisma({
      baUser: {
        override_permissions: ['view_orders'],
        denied_permissions: [],
      },
      employee: null,
    });
    const perms = await loadEffectivePermissions(prisma, {
      role: 'admin',
      betterAuthUserId: 'ba-1',
    });
    expect(perms).toEqual(getAllPermissions());
  });

  it('an admin WITH a linked preset gets exactly the preset (preset supremacy)', async () => {
    const prisma = makePrisma({
      baUser: { override_permissions: [], denied_permissions: [] },
      employee: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders'] },
      },
    });
    const perms = await loadEffectivePermissions(prisma, {
      role: 'admin',
      betterAuthUserId: 'ba-1',
    });
    expect(perms).toEqual(['view_orders']);
  });

  it('an employee preset applies even when the BA row is missing (post-cutover users have no tenant BA row)', async () => {
    const prisma = makePrisma({
      baUser: null,
      employee: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders'] },
      },
    });
    const perms = await loadEffectivePermissions(prisma, {
      role: 'employee',
      betterAuthUserId: 'ba-1',
    });
    expect(perms).toEqual(['view_orders']);
  });

  it('DB errors PROPAGATE (callers decide the failure policy)', async () => {
    const prisma = makePrisma({ baError: new Error('db down') });
    await expect(
      loadEffectivePermissions(prisma, {
        role: 'employee',
        betterAuthUserId: 'ba-1',
      }),
    ).rejects.toThrow('db down');
  });
});
