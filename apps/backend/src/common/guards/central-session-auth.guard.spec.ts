// Phase 3 central-auth cutover — CentralSessionAuthGuard.
// The CentralAuthClient is mocked (its own HTTP behaviour is covered by
// central-auth.client.spec.ts); the guard's decisions are covered here.
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CentralSessionAuthGuard } from './central-session-auth.guard';
import { CentralAuthClient } from '../../auth/central-auth.client';
import { PrismaService } from '../../prisma/prisma.service';
import { getAllPermissions } from '../permissions/registry';
import { getTenantContext, runWithTenant } from '../../tenancy/tenant-context';

describe('CentralSessionAuthGuard', () => {
  let guard: CentralSessionAuthGuard;
  let centralAuth: jest.Mocked<CentralAuthClient>;
  let prisma: any;
  let reflector: { getAllAndOverride: jest.Mock };

  const TENANT_ID = 'tenant-1';
  const CENTRAL_USER_ID = 'central-user-1';

  const sessionFor = (overrides: Record<string, unknown> = {}) => ({
    session: {
      id: 'sess-1',
      userId: CENTRAL_USER_ID,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      activeOrganizationId: null,
      impersonatedBy: null,
      ...((overrides.session as Record<string, unknown>) ?? {}),
    },
    user: {
      id: CENTRAL_USER_ID,
      email: 'owner@example.com',
      emailVerified: true,
      name: 'Owner One',
      role: 'user',
      ...(overrides.user as Record<string, unknown>),
    },
  });

  const makeContext = (opts: {
    cookie?: string;
    host?: string;
    isPublic?: boolean;
  } = {}) => {
    reflector.getAllAndOverride.mockReturnValue(!!opts.isPublic);
    const request: any = {
      headers: {
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.host ? { host: opts.host } : {}),
      },
    };
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    return { context, request };
  };

  const profileFor = (role: string, extra: Record<string, unknown> = {}) => ({
    id: `profile-${role}`,
    firstName: 'Test',
    lastName: 'User',
    username: `test-${role}`,
    email: 'owner@example.com',
    phoneNumber: '',
    password: '',
    role,
    status: 'active',
    lockoutUntil: null,
    betterAuthUserId: CENTRAL_USER_ID,
    ...extra,
  });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn(() => false) };
    centralAuth = {
      getSession: jest.fn(),
      listOrganizations: jest.fn(),
      getOrganizationMember: jest.fn(),
      resolveTenantIdForOrg: jest.fn(() => TENANT_ID),
    } as unknown as jest.Mocked<CentralAuthClient>;
    prisma = {
      userProfile: { findFirst: jest.fn(), create: jest.fn() },
      userSettings: { create: jest.fn() },
      customerProfile: { upsert: jest.fn() },
      betterAuthUser: { findFirst: jest.fn() },
      employee: { findFirst: jest.fn() },
    };
    prisma.betterAuthUser.findFirst.mockResolvedValue({
      override_permissions: [],
      denied_permissions: [],
    });
    prisma.employee.findFirst.mockResolvedValue(null);
    guard = new CentralSessionAuthGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
      centralAuth,
    );
  });

  const run = async (opts: {
    cookie?: string;
    host?: string;
    isPublic?: boolean;
    tenant?: Record<string, unknown>;
  } = {}) => {
    const { context, request } = makeContext(opts);
    const tenant = {
      tenantId: TENANT_ID,
      slug: 'acme',
      canonicalHost: 'tenant1.faah.net',
      ...(opts.tenant ?? {}),
    };
    const result = await runWithTenant(tenant as any, () =>
      guard.canActivate(context),
    );
    return { result, request };
  };

  const cookie = '__Secure-better-auth.session_token=tok-1';

  it('staff profile + org member → allowed, loader permissions, session attached', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst.mockResolvedValue(profileFor('admin'));
    centralAuth.getOrganizationMember.mockResolvedValue('admin');

    const { result, request } = await run({ cookie });
    expect(result).toBe(true);
    expect(request.user.userId).toBe('profile-admin');
    expect(request.user.permissions).toEqual(getAllPermissions());
    expect(request.user.betterAuthSession).toBeDefined();
    expect(request.user.impersonated).toBe(false);
    expect(centralAuth.getOrganizationMember).toHaveBeenCalledWith(
      cookie,
      'tenant1.faah.net',
      TENANT_ID,
      CENTRAL_USER_ID,
    );
    expect(prisma.customerProfile.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['superadmin', 'owner'],
    ['admin', 'admin'],
    ['cashier', 'cashier'],
    ['packing_assistant', 'packing_assistant'],
    ['employee', 'employee'],
  ])('role matrix: %s staff member is allowed', async (role, orgRole) => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst.mockResolvedValue(profileFor(role));
    centralAuth.getOrganizationMember.mockResolvedValue(orgRole);

    const { result, request } = await run({ cookie });
    expect(result).toBe(true);
    expect(request.user.role).toBe(role);
  });

  it('customer profile → allowed WITHOUT an org call, CustomerProfile linked', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst.mockResolvedValue(profileFor('customer'));

    const { result, request } = await run({ cookie });
    expect(result).toBe(true);
    expect(request.user.permissions).toEqual([]);
    expect(centralAuth.getOrganizationMember).not.toHaveBeenCalled();
    expect(prisma.customerProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { betterAuthUserId: CENTRAL_USER_ID },
      }),
    );
  });

  it('staff profile but NOT a member of the host org → 403', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst.mockResolvedValue(profileFor('admin'));
    centralAuth.getOrganizationMember.mockResolvedValue(null);

    await expect(run({ cookie })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run({ cookie })).rejects.toThrow(
      'You are not a member of this organization',
    );
  });

  it('no profile + host org in list → staff auto-create with the mapped role', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst
      .mockResolvedValueOnce(null) // profile lookup
      .mockResolvedValueOnce(null); // username uniqueness loop
    centralAuth.listOrganizations.mockResolvedValue([
      { id: TENANT_ID, slug: 'acme' },
    ]);
    centralAuth.getOrganizationMember.mockResolvedValue('owner');
    prisma.userProfile.create.mockImplementation(async ({ data }: any) => ({
      id: 'profile-new',
      ...data,
      status: 'active',
      lockoutUntil: null,
    }));

    const { result, request } = await run({ cookie });
    expect(result).toBe(true);
    expect(prisma.userProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'superadmin',
          betterAuthUserId: CENTRAL_USER_ID,
        }),
      }),
    );
    expect(prisma.userSettings.create).toHaveBeenCalledWith({
      data: { userId: 'profile-new' },
    });
    expect(request.user.role).toBe('superadmin');
  });

  it('no profile + org list non-empty but host org absent → 403 (staff of another tenant)', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst.mockResolvedValue(null);
    centralAuth.listOrganizations.mockResolvedValue([
      { id: 'other-tenant', slug: 'other' },
    ]);

    await expect(run({ cookie })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userProfile.create).not.toHaveBeenCalled();
  });

  it('no profile + empty org list → customer auto-create + CustomerProfile', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    centralAuth.listOrganizations.mockResolvedValue([]);
    prisma.userProfile.create.mockImplementation(async ({ data }: any) => ({
      id: 'profile-new-customer',
      ...data,
      status: 'active',
      lockoutUntil: null,
    }));

    const { result, request } = await run({ cookie });
    expect(result).toBe(true);
    expect(prisma.userProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'customer' }),
      }),
    );
    expect(prisma.customerProfile.upsert).toHaveBeenCalled();
    expect(request.user.role).toBe('customer');
  });

  it('no profile + unknown org role → 401 fail-closed', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst.mockResolvedValue(null);
    centralAuth.listOrganizations.mockResolvedValue([
      { id: TENANT_ID, slug: 'acme' },
    ]);
    centralAuth.getOrganizationMember.mockResolvedValue('wizard');

    await expect(run({ cookie })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.userProfile.create).not.toHaveBeenCalled();
  });

  it('impersonated session maps impersonatedBy → imp/impActor = CENTRAL USER ID (not email)', async () => {
    centralAuth.getSession.mockResolvedValue(
      sessionFor({ session: { impersonatedBy: 'central-admin-9' } }) as any,
    );
    prisma.userProfile.findFirst.mockResolvedValue(profileFor('superadmin'));
    centralAuth.getOrganizationMember.mockResolvedValue('owner');

    const { context, request } = makeContext({ cookie });
    await runWithTenant(
      { tenantId: TENANT_ID, slug: 'acme', canonicalHost: 'tenant1.faah.net' } as any,
      async () => {
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
        expect(getTenantContext()?.impersonation).toEqual({
          impersonated: true,
          actor: 'central-admin-9',
        });
      },
    );
    expect(request.user.impersonated).toBe(true);
    expect(request.user.impersonationActor).toBe('central-admin-9');
  });

  it('activeOrganizationId is NOT a gate: active org A + member of host org B → allowed', async () => {
    centralAuth.getSession.mockResolvedValue(
      sessionFor({ session: { activeOrganizationId: 'other-org' } }) as any,
    );
    prisma.userProfile.findFirst.mockResolvedValue(profileFor('admin'));
    centralAuth.getOrganizationMember.mockResolvedValue('admin');

    const { result } = await run({ cookie });
    expect(result).toBe(true);
  });

  it('no session on a protected route → 401', async () => {
    centralAuth.getSession.mockResolvedValue(null);
    await expect(run({ cookie })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('no session on a public route → passes without a user', async () => {
    centralAuth.getSession.mockResolvedValue(null);
    const { result, request } = await run({ isPublic: true });
    expect(result).toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('auth-service outage fails CLOSED on protected routes (503), public routes pass', async () => {
    centralAuth.getSession.mockRejectedValue(
      new ServiceUnavailableException('Central auth service unavailable'),
    );
    await expect(run({ cookie })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const { result } = await run({ isPublic: true });
    expect(result).toBe(true);
  });

  it('loader error denies fail-closed (401)', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst.mockResolvedValue(profileFor('admin'));
    centralAuth.getOrganizationMember.mockResolvedValue('admin');
    prisma.betterAuthUser.findFirst.mockRejectedValue(new Error('db down'));

    await expect(run({ cookie })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('inactive or locked-out profile → 401', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    centralAuth.getOrganizationMember.mockResolvedValue('admin');

    prisma.userProfile.findFirst.mockResolvedValue(
      profileFor('admin', { status: 'suspended' }),
    );
    await expect(run({ cookie })).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.userProfile.findFirst.mockResolvedValue(
      profileFor('admin', { lockoutUntil: new Date(Date.now() + 600_000) }),
    );
    await expect(run({ cookie })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('public route with a valid session still attaches the user', async () => {
    centralAuth.getSession.mockResolvedValue(sessionFor() as any);
    prisma.userProfile.findFirst.mockResolvedValue(profileFor('admin'));
    centralAuth.getOrganizationMember.mockResolvedValue('admin');

    const { result, request } = await run({ cookie, isPublic: true });
    expect(result).toBe(true);
    expect(request.user.userId).toBe('profile-admin');
  });
});
