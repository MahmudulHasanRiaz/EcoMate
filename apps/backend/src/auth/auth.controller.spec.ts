import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SecurityService } from '../security/security.service';
import { PrismaService } from '../prisma/prisma.service';
import { getAllPermissions } from '../common/permissions/registry';
import { loadEffectivePermissions } from '../common/permissions/permissions-loader';

describe('AuthController — me() permission fallback', () => {
  let controller: AuthController;
  let prisma: PrismaService;

  // The real permission computation now lives in AuthService (which
  // delegates to the ONE loader); the mock calls the loader against the
  // prisma mock so the fallback behaviour the controller used to
  // implement itself stays under test.
  const mockAuthService = {
    me: jest.fn(),
    adminLogin: jest.fn(),
    changePassword: jest.fn().mockResolvedValue({ message: 'ok' }),
    computePermissionsForUser: jest.fn(async (user: any) => {
      return loadEffectivePermissions(prisma!, {
        role: user.role,
        betterAuthUserId: user.betterAuthUserId,
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
          useValue: {
            betterAuthUser: { findFirst: jest.fn() },
            employee: { findFirst: jest.fn() },
          },
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

  it('admin without permissions → ALL registered keys (loader re-reads: no preset, no overrides)', async () => {
    (prisma.betterAuthUser.findFirst as jest.Mock).mockResolvedValue({
      override_permissions: [],
      denied_permissions: [],
    });
    (prisma.employee.findFirst as jest.Mock).mockResolvedValue(null);
    const result = await controller.me({
      userId: 'user-1',
      role: 'admin',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual(getAllPermissions());
    // Phase 3 R-8: the ONE loader re-reads overrides + the employee
    // link on every call for a linked admin (the old mirror short-
    // circuited admin → all without a DB read).
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
  });

  it('employee without permissions + BA row with preset & override → union', async () => {
    (prisma.betterAuthUser.findFirst as jest.Mock).mockResolvedValue({
      override_permissions: ['view_orders'],
      denied_permissions: [],
    });
    (prisma.employee.findFirst as jest.Mock).mockResolvedValue({
      accessPreset: { permissions: ['view_customers'] },
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
        denied_permissions: true,
      },
    });
    expect(prisma.employee.findFirst).toHaveBeenCalledWith({
      where: { betterAuthUserId: 'ba-1' },
      include: { accessPreset: true },
    });
  });

  it('employee with BA row but no employee link → employee role defaults (no preset in use)', async () => {
    (prisma.betterAuthUser.findFirst as jest.Mock).mockResolvedValue({
      override_permissions: [],
      denied_permissions: [],
    });
    (prisma.employee.findFirst as jest.Mock).mockResolvedValue(null);
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
      { headers: { cookie: 'session_token=tok', host: 'tenant1.faah.net' } } as any,
    );
    expect(mockAuthService.changePassword).toHaveBeenCalledWith(
      'user-1',
      { currentPassword: 'old', newPassword: 'new-password-123' },
      { cookie: 'session_token=tok', host: 'tenant1.faah.net' },
    );
  });
});