import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SecurityService } from '../security/security.service';
import { PrismaService } from '../prisma/prisma.service';
import { getAllPermissions } from '../common/permissions/registry';
import {
  computeEffectivePermissions,
  getRoleDefaultPermissions,
} from '../common/permissions/effective-permissions';

describe('AuthController — me() permission fallback', () => {
  let controller: AuthController;
  let prisma: PrismaService;

  // The real permission computation now lives in AuthService; the mock
  // mirrors it against the prisma mock so the fallback behaviour the
  // controller used to implement itself stays under test.
  const mockAuthService = {
    me: jest.fn(),
    adminLogin: jest.fn(),
    impersonate: jest.fn(),
    changePassword: jest.fn().mockResolvedValue({ message: 'ok' }),
    computePermissionsForUser: jest.fn(async (user: any) => {
      const role = user.role || 'customer';
      if (role === 'superadmin' || role === 'admin') {
        return getAllPermissions();
      }
      if (role === 'customer') {
        return [];
      }
      // Mirror of the real no-BA-link fallback: shared role defaults, not
      // a hardcoded [] — preset-less employees get their four restored
      // keys (2026-10-28 client-compat fix).
      if (!user.betterAuthUserId) {
        return getRoleDefaultPermissions(role);
      }
      const baUser = await prisma!.betterAuthUser.findFirst({
        where: { id: user.betterAuthUserId },
        select: {
          override_permissions: true,
          employee: { include: { accessPreset: true } },
        },
      });
      return computeEffectivePermissions({
        role,
        employeeLink: baUser?.employee ?? null,
        overridePermissions: baUser?.override_permissions,
      });
    }),
  };
  const mockSecurity = { recordFailedLogin: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.me.mockResolvedValue({
      id: 'user-1',
      firstName: 'Jane',
      role: 'admin',
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: SecurityService, useValue: mockSecurity },
        {
          provide: PrismaService,
          useValue: { betterAuthUser: { findFirst: jest.fn() } },
        },
      ],
    }).compile();
    controller = module.get<AuthController>(AuthController);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('passes through BA-attached permissions without BA query', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'employee',
      permissions: ['view_orders'],
    });
    expect(result.permissions).toEqual(['view_orders']);
    expect(prisma.betterAuthUser.findFirst).not.toHaveBeenCalled();
  });

  it('superadmin without permissions → ALL registered keys, no BA query', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'superadmin',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual(getAllPermissions());
    expect(prisma.betterAuthUser.findFirst).not.toHaveBeenCalled();
  });

  it('admin without permissions → ALL registered keys, no BA query', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'admin',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual(getAllPermissions());
    expect(prisma.betterAuthUser.findFirst).not.toHaveBeenCalled();
  });

  it('employee without permissions + BA row with preset & override → union', async () => {
    (prisma.betterAuthUser.findFirst as jest.Mock).mockResolvedValue({
      override_permissions: ['view_orders'],
      employee: { accessPreset: { permissions: ['view_customers'] } },
    });
    const result = await controller.me({
      userId: 'user-1',
      role: 'employee',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual(['view_customers', 'view_orders']);
    expect(prisma.betterAuthUser.findFirst).toHaveBeenCalledWith({
      where: { id: 'ba-1' },
      select: {
        override_permissions: true,
        employee: { include: { accessPreset: true } },
      },
    });
  });

  it('employee with BA row but no employee link → employee role defaults (no preset in use)', async () => {
    (prisma.betterAuthUser.findFirst as jest.Mock).mockResolvedValue({
      override_permissions: [],
      employee: null,
    });
    const result = await controller.me({
      userId: 'user-1',
      role: 'employee',
      betterAuthUserId: 'ba-1',
    });
    // Was [] before the 2026-10-28 client-compat fix; no preset is in use
    // here, so the four restored role-default keys apply.
    expect(result.permissions).toEqual([
      'view_media',
      'view_customer_reviews',
      'approve_customer_reviews',
      'view_cod_mismatch',
    ]);
  });

  it('customer → [] (no throw) even with betterAuthUserId', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'customer',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual([]);
    expect(prisma.betterAuthUser.findFirst).not.toHaveBeenCalled();
  });

  it('non-admin with null betterAuthUserId → employee role defaults without BA query (no throw)', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'employee',
      betterAuthUserId: null,
    });
    // Was [] before the 2026-10-28 client-compat fix; the no-BA-query
    // behaviour is unchanged, only the fallback value changed.
    expect(result.permissions).toEqual([
      'view_media',
      'view_customer_reviews',
      'approve_customer_reviews',
      'view_cod_mismatch',
    ]);
    expect(prisma.betterAuthUser.findFirst).not.toHaveBeenCalled();
  });

  it('profile data preserved alongside permissions', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'admin',
    });
    expect(result).toMatchObject({
      id: 'user-1',
      firstName: 'Jane',
      permissions: getAllPermissions(),
    });
  });

  it('admin-login delegates to authService.adminLogin and sets the refresh cookie', async () => {
    mockAuthService.adminLogin.mockResolvedValue({
      accessToken: 'at',
      refreshToken: 'rt',
      user: { id: 'user-1', role: 'admin', permissions: [] },
    });
    const mockRes = { cookie: jest.fn() } as any;
    const mockReq = { ip: '203.0.113.9' };

    const result = await controller.adminLogin(
      { email: 'admin@x.com', password: 'secret123' },
      mockRes,
      mockReq,
    );

    expect(mockAuthService.adminLogin).toHaveBeenCalledWith({
      email: 'admin@x.com',
      password: 'secret123',
    });
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'rt',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result).toEqual({
      accessToken: 'at',
      user: { id: 'user-1', role: 'admin', permissions: [] },
    });
  });

  it('sets the tenant admin cookie and redirects after impersonation', async () => {
    const res = {
      cookie: jest.fn(),
      code: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as any;
    mockAuthService.impersonate.mockResolvedValue({
      accessToken: 'impersonated-token',
      expiresIn: 900,
      user: { id: 'user-1', email: 'owner@example.com', role: 'superadmin' },
    });

    await controller.impersonate('a'.repeat(64), res);

    expect(mockAuthService.impersonate).toHaveBeenCalledWith('a'.repeat(64));
    expect(res.cookie).toHaveBeenCalledWith(
      'eco_mate_access_token',
      'impersonated-token',
      expect.objectContaining({
        httpOnly: false,
        path: '/',
        maxAge: 900_000,
      }),
    );
    expect(res.code).toHaveBeenCalledWith(302);
    expect(res.header).toHaveBeenCalledWith('location', '/admin/');
    expect(res.send).toHaveBeenCalled();
  });

  it('redirects to sign-in when impersonation fails', async () => {
    const res = {
      cookie: jest.fn(),
      code: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as any;
    mockAuthService.impersonate.mockRejectedValue(new Error('invalid'));

    await controller.impersonate('b'.repeat(64), res);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.code).toHaveBeenCalledWith(302);
    expect(res.header).toHaveBeenCalledWith(
      'location',
      '/admin/sign-in?impersonation=failed',
    );
    expect(res.send).toHaveBeenCalled();
  });

  it('blocks password changes during an impersonated session', async () => {
    await expect(
      controller.changePassword(
        { userId: 'user-1', impersonated: true } as any,
        { currentPassword: 'old', newPassword: 'new-password-123' } as any,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(mockAuthService.changePassword).not.toHaveBeenCalled();
  });

  it('allows password changes for ordinary sessions', async () => {
    await controller.changePassword(
      { userId: 'user-1' } as any,
      { currentPassword: 'old', newPassword: 'new-password-123' } as any,
    );
    expect(mockAuthService.changePassword).toHaveBeenCalledWith(
      'user-1',
      { currentPassword: 'old', newPassword: 'new-password-123' },
    );
  });
});