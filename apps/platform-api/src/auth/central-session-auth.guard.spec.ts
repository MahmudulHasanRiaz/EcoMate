import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CentralSessionAuthGuard } from './central-session-auth.guard';
import type { CentralSession } from './central-auth.client';

function makeSession(platformRole: string | null, overrides: any = {}): CentralSession {
  return {
    session: {
      id: 'sess-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    user: {
      id: 'user-1',
      email: 'admin@ecomate.test',
      emailVerified: true,
      name: 'Admin',
      role: 'user',
      platformRole,
      twoFactorEnabled: false,
      ...overrides,
    },
  };
}

function makeContext(headers: any = {}) {
  const request: any = { headers };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any,
  };
}

function makeGuard(central: any, prismaUser: any) {
  const prisma: any = {
    platformUser: { findUnique: jest.fn().mockResolvedValue(prismaUser) },
  };
  return {
    prisma,
    guard: new CentralSessionAuthGuard(central as any, prisma as any),
  };
}

const DB_USER = {
  id: 'user-1',
  email: 'admin@ecomate.test',
  name: 'Admin',
  role: 'SUPERADMIN',
  status: 'ACTIVE',
};

describe('CentralSessionAuthGuard', () => {
  it('sets platformUser from the DB row with the role from session.user.platformRole', async () => {
    const central = { getSession: jest.fn().mockResolvedValue(makeSession('SUPERADMIN')) };
    const { guard, prisma } = makeGuard(central, DB_USER);
    const { request, context } = makeContext({ cookie: 'better-auth.session_token=tok', host: 'em.commercians.com' });

    expect(await guard.canActivate(context)).toBe(true);
    expect(request.platformUser).toEqual({
      id: 'user-1',
      email: 'admin@ecomate.test',
      name: 'Admin',
      role: 'SUPERADMIN',
    });
    expect(request.centralSession.user.platformRole).toBe('SUPERADMIN');
    expect(prisma.platformUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: expect.objectContaining({ status: true }),
    });
  });

  it('uses platformRole, NOT the BA admin-plugin user.role, for every role', async () => {
    for (const platformRole of ['SUPERADMIN', 'SUPPORT', 'BILLING', 'READONLY']) {
      const central = {
        getSession: jest.fn().mockResolvedValue(
          makeSession(platformRole, { role: 'admin' }),
        ),
      };
      const { guard } = makeGuard(central, { ...DB_USER, role: platformRole });
      const { request, context } = makeContext({ cookie: 'x', host: 'h' });
      await guard.canActivate(context);
      expect(request.platformUser.role).toBe(platformRole);
    }
  });

  it('401s with no session, with no platformRole, and for a disabled operator', async () => {
    const noSession = { getSession: jest.fn().mockResolvedValue(null) };
    const { guard: g1 } = makeGuard(noSession, DB_USER);
    await expect(
      g1.canActivate(makeContext().context),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const noRole = { getSession: jest.fn().mockResolvedValue(makeSession(null)) };
    const { guard: g2 } = makeGuard(noRole, DB_USER);
    await expect(
      g2.canActivate(makeContext().context),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const disabled = { getSession: jest.fn().mockResolvedValue(makeSession('SUPERADMIN')) };
    const { guard: g3 } = makeGuard(disabled, { ...DB_USER, status: 'DISABLED' });
    await expect(
      g3.canActivate(makeContext().context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed with the client 503 on an auth-service outage', async () => {
    const central = {
      getSession: jest
        .fn()
        .mockRejectedValue(new ServiceUnavailableException('down')),
    };
    const { guard } = makeGuard(central, DB_USER);
    await expect(
      guard.canActivate(makeContext().context),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
