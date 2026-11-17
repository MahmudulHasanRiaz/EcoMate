import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { DualModeAuthGuard } from './dual-mode-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { getAllPermissions } from '../permissions/registry';
import {
  getTenantContext,
  runWithTenant,
} from '../../tenancy/tenant-context';

jest.mock('../../better-auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('better-auth/node', () => ({
  fromNodeHeaders: jest.fn(() => ({})),
}));

import { auth } from '../../better-auth/auth.config';

describe('DualModeAuthGuard — JWT path permissions via computeEffectivePermissions', () => {
  let guard: DualModeAuthGuard;
  let prisma: PrismaService;

  const mockJwt = {
    verifyAsync: jest.fn(),
  };

  const makeContext = (authorization?: string) => {
    const request: any = { headers: { authorization } };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (auth.api.getSession as jest.Mock).mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        DualModeAuthGuard,
        Reflector,
        { provide: JwtService, useValue: mockJwt },
        {
          provide: PrismaService,
          useValue: {
            userProfile: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
            },
            userSettings: { create: jest.fn() },
            betterAuthUser: { findFirst: jest.fn() },
          },
        },
      ],
    }).compile();
    guard = module.get<DualModeAuthGuard>(DualModeAuthGuard);
    prisma = module.get<PrismaService>(PrismaService);
    mockJwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
  });

  it('admin JWT user with NO linked preset gets ALL registered permissions (BA query now runs to check for one)', async () => {
    (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'admin',
      status: 'active',
      betterAuthUserId: 'ba-1',
    });
    (prisma.betterAuthUser.findFirst as jest.Mock).mockResolvedValue({
      override_permissions: [],
      denied_permissions: [],
      employee: null,
    });

    const context = makeContext('Bearer <redacted>');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(context.switchToHttp().getRequest().user.permissions).toEqual(
      getAllPermissions(),
    );
    expect(prisma.betterAuthUser.findFirst).toHaveBeenCalledWith({
      where: { id: 'ba-1' },
      select: {
        override_permissions: true,
        denied_permissions: true,
        employee: { include: { accessPreset: true } },
      },
    });
  });

  it('admin JWT user WITH a linked preset gets exactly the preset (preset supremacy)', async () => {
    (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'admin',
      status: 'active',
      betterAuthUserId: 'ba-1',
    });
    (prisma.betterAuthUser.findFirst as jest.Mock).mockResolvedValue({
      override_permissions: [],
      denied_permissions: [],
      employee: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders'] },
      },
    });

    const context = makeContext('Bearer <redacted>');
    await guard.canActivate(context);

    expect(context.switchToHttp().getRequest().user.permissions).toEqual([
      'view_orders',
    ]);
  });

  it('employee JWT user with employee link gets preset ∪ override permissions', async () => {
    (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'employee',
      status: 'active',
      betterAuthUserId: 'ba-1',
    });
    (prisma.betterAuthUser.findFirst as jest.Mock).mockResolvedValue({
      override_permissions: ['view_orders', 'ghost_key'],
      denied_permissions: [],
      employee: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_customers'] },
      },
    });

    const context = makeContext('Bearer token-1');
    await guard.canActivate(context);

    expect(prisma.betterAuthUser.findFirst).toHaveBeenCalledWith({
      where: { id: 'ba-1' },
      select: {
        override_permissions: true,
        denied_permissions: true,
        employee: { include: { accessPreset: true } },
      },
    });
    const req = context.switchToHttp().getRequest();
    expect(req.user.permissions).toEqual(['view_customers', 'view_orders']);
    expect(req.user.userId).toBe('user-1');
  });

  it('employee JWT user without betterAuthUserId gets employee role defaults and no BA query (no throw)', async () => {
    (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'employee',
      status: 'active',
      betterAuthUserId: null,
    });

    const context = makeContext('Bearer token-1');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    // Was [] before the 2026-10-28 client-compat fix; preset-less employees
    // now fall back to their four restored role-default keys (see
    // effective-permissions.ts). The no-BA-query behaviour is unchanged.
    expect(context.switchToHttp().getRequest().user.permissions).toEqual([
      'view_media',
      'view_customer_reviews',
      'approve_customer_reviews',
      'view_cod_mismatch',
    ]);
    expect(prisma.betterAuthUser.findFirst).not.toHaveBeenCalled();
  });

  it('customer JWT user gets [] even if BA row exists', async () => {
    (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'customer',
      status: 'active',
      betterAuthUserId: 'ba-1',
    });
    (prisma.betterAuthUser.findFirst as jest.Mock).mockResolvedValue({
      override_permissions: [],
      employee: null,
    });

    const context = makeContext('Bearer token-1');
    await guard.canActivate(context);

    expect(context.switchToHttp().getRequest().user.permissions).toEqual([]);
  });

  it('BA session path keeps session.user.permissions on request.user (unchanged)', async () => {
    (auth.api.getSession as jest.Mock).mockResolvedValue({
      user: { id: 'ba-1', role: 'employee', permissions: ['view_orders'] },
      session: { id: 's-1' },
    });
    (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'employee',
      status: 'active',
      betterAuthUserId: 'ba-1',
    });

    const context = makeContext();
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    const req = context.switchToHttp().getRequest();
    expect(req.user.permissions).toEqual(['view_orders']);
    expect(req.user.betterAuthSession).toBeDefined();
  });

  describe('impersonation claim (imp)', () => {
    it('marks request.user as impersonated and stamps the tenant context', async () => {
      mockJwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        imp: true,
        impActor: 'ops@ecomate.bd',
      });
      (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'user-1',
        role: 'superadmin',
        status: 'active',
      });

      const context = makeContext('Bearer <redacted>');
      // The ALS stamp is read by the security-event emitter inside the
      // same request; assert it from within the context.
      await runWithTenant({ tenantId: 'tenant-1', slug: 'acme' }, async () => {
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
        expect(getTenantContext()?.impersonation).toEqual({
          impersonated: true,
          actor: 'ops@ecomate.bd',
        });
      });
      const req = context.switchToHttp().getRequest();
      expect(req.user.impersonated).toBe(true);
      expect(req.user.impersonationActor).toBe('ops@ecomate.bd');
    });

    it('stamps the flag even when no platform actor identity is present', async () => {
      mockJwt.verifyAsync.mockResolvedValue({ sub: 'user-1', imp: true });
      (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'user-1',
        role: 'superadmin',
        status: 'active',
      });

      const context = makeContext('Bearer <redacted>');
      await runWithTenant({ tenantId: 'tenant-1', slug: 'acme' }, async () => {
        await guard.canActivate(context);
        expect(getTenantContext()?.impersonation).toEqual({
          impersonated: true,
          actor: null,
        });
      });
      expect(
        context.switchToHttp().getRequest().user.impersonated,
      ).toBe(true);
      expect(
        context.switchToHttp().getRequest().user.impersonationActor,
      ).toBeUndefined();
    });

    it('leaves ordinary JWT sessions unmarked', async () => {
      mockJwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'user-1',
        role: 'superadmin',
        status: 'active',
      });

      const context = makeContext('Bearer <redacted>');
      await runWithTenant({ tenantId: 'tenant-1', slug: 'acme' }, async () => {
        await guard.canActivate(context);
        expect(getTenantContext()?.impersonation).toBeUndefined();
      });
      expect(
        context.switchToHttp().getRequest().user.impersonated,
      ).toBe(false);
    });
  });
});