import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { UsersService } from './users.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function makeAdmin(overrides: any = {}) {
  return {
    id: ADMIN_ID,
    email: 'admin@ecomate.test',
    name: 'Platform Admin',
    role: 'SUPERADMIN',
    status: 'ACTIVE',
    passwordHash: 'hash',
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeService() {
  const admin = makeAdmin();
  const prisma: any = {
    platformUser: {
      findMany: jest.fn().mockResolvedValue([admin]),
      findUnique: jest.fn().mockResolvedValue(null),
      // The real calls use select: userSelect, which never returns the
      // password hash — the mocks mirror that.
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const { passwordHash: _passwordHash, ...safe } = data;
        return {
          id: USER_ID,
          ...safe,
          lastLoginAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        const { passwordHash: _passwordHash, ...safeAdmin } = admin;
        return { ...safeAdmin, ...data };
      }),
      delete: jest.fn().mockResolvedValue(admin),
      count: jest.fn().mockResolvedValue(1),
    },
    platformRefreshToken: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    platformUserInvite: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'invite-1',
        ...data,
        usedAt: null,
        createdAt: new Date(),
      })),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  prisma.$transaction = jest.fn(async (input: any) =>
    typeof input === 'function' ? input(prisma) : Promise.all(input),
  );
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const mail = {
    sendInvite: jest.fn().mockResolvedValue({ delivered: true }),
  };
  const mfa = { clearMfa: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    audit,
    mail,
    mfa,
    admin,
    service: new UsersService(prisma as any, audit as any, mail as any, mfa as any),
  };
}

describe('UsersService', () => {
  const ORIGINAL_ADMIN_URL = process.env.PLATFORM_ADMIN_URL;

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_URL = 'https://saas.ecomate.test';
  });

  afterAll(() => {
    if (ORIGINAL_ADMIN_URL === undefined) delete process.env.PLATFORM_ADMIN_URL;
    else process.env.PLATFORM_ADMIN_URL = ORIGINAL_ADMIN_URL;
  });

  it('lists users with filters and page meta', async () => {
    const { service, prisma } = makeService();

    const result = await service.list({
      page: '2',
      limit: '10',
      role: 'BILLING',
      search: 'acme',
    });

    expect(prisma.platformUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: 'BILLING',
          OR: expect.arrayContaining([
            { email: { contains: 'acme', mode: 'insensitive' } },
          ]),
        }),
        skip: 10,
        take: 10,
      }),
    );
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('creates a user with a normalized email and a bcrypt hash', async () => {
    const { service, prisma, audit } = makeService();

    const result = await service.create(
      {
        email: '  New@Ecomate.Test ',
        name: '  New User ',
        role: 'BILLING',
        password: 'a-very-long-password',
      } as any,
      ADMIN_ID,
    );

    const data = prisma.platformUser.create.mock.calls[0][0].data;
    expect(data.email).toBe('new@ecomate.test');
    expect(data.name).toBe('New User');
    expect(
      await bcrypt.compare('a-very-long-password', data.passwordHash),
    ).toBe(true);
    expect(result).not.toHaveProperty('passwordHash');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: 'users.create',
        entity: 'PlatformUser',
      }),
    );
  });

  it('refuses to create a duplicate email', async () => {
    const { service, prisma, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue(admin);

    await expect(
      service.create(
        {
          email: 'admin@ecomate.test',
          name: 'Dup',
          role: 'SUPPORT',
          password: 'a-very-long-password',
        } as any,
        ADMIN_ID,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates name and role and audits before/after', async () => {
    const { service, prisma, audit, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
      role: 'SUPPORT',
    });

    await service.update(
      USER_ID,
      { name: 'Renamed', role: 'BILLING' } as any,
      ADMIN_ID,
    );

    expect(prisma.platformUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: { name: 'Renamed', role: 'BILLING' },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'users.update',
        before: expect.objectContaining({ role: 'SUPPORT' }),
        after: expect.objectContaining({ role: 'BILLING' }),
      }),
    );
  });

  it('refuses a self role change or self disable', async () => {
    const { service, prisma, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue(admin);

    await expect(
      service.update(ADMIN_ID, { role: 'BILLING' } as any, ADMIN_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(ADMIN_ID, { status: 'DISABLED' } as any, ADMIN_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to demote the last active superadmin', async () => {
    const { service, prisma, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
    });
    prisma.platformUser.count.mockResolvedValue(0);

    await expect(
      service.update(USER_ID, { role: 'BILLING' } as any, ADMIN_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.platformUser.count).toHaveBeenCalledWith({
      where: {
        role: 'SUPERADMIN',
        status: 'ACTIVE',
        id: { not: USER_ID },
      },
    });
  });

  it('refuses to delete an active account and to delete yourself', async () => {
    const { service, prisma, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
    });

    await expect(service.remove(USER_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.remove(ADMIN_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deletes a disabled account and audits it', async () => {
    const { service, prisma, audit, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
      status: 'DISABLED',
    });

    const result = await service.remove(USER_ID, ADMIN_ID);

    expect(prisma.platformUser.delete).toHaveBeenCalledWith({
      where: { id: USER_ID },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'users.delete', entityId: USER_ID }),
    );
    expect(result).toEqual({ success: true });
  });

  it('resets a password, revokes sessions and returns the temp password once', async () => {
    const { service, prisma, audit, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
    });

    const result = await service.resetPassword(USER_ID, ADMIN_ID);

    expect(typeof result.temporaryPassword).toBe('string');
    expect(result.temporaryPassword.length).toBe(16);
    const data = prisma.platformUser.update.mock.calls[0][0].data;
    expect(
      await bcrypt.compare(result.temporaryPassword, data.passwordHash),
    ).toBe(true);
    expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    const auditCall = audit.record.mock.calls[0][0];
    expect(auditCall.action).toBe('users.password.reset');
    expect(JSON.stringify(auditCall)).not.toContain(
      result.temporaryPassword,
    );
    await expect(
      service.resetPassword(ADMIN_ID, ADMIN_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resets MFA for another user and audits it; refuses self-reset', async () => {
    const { service, prisma, audit, mfa, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
    });

    const result = await service.resetMfa(USER_ID, ADMIN_ID);

    expect(result).toEqual({ success: true });
    expect(mfa.clearMfa).toHaveBeenCalledWith(USER_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: 'users.mfa.reset',
        entityId: USER_ID,
      }),
    );
    await expect(
      service.resetMfa(ADMIN_ID, ADMIN_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an MFA reset for a missing user', async () => {
    const { service, prisma } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue(null);
    await expect(service.resetMfa(USER_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists sessions grouped by rotation family, newest activity first', async () => {
    const { service, prisma, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
    });
    // Family A: two rows (login + one refresh), family B: one row.
    prisma.platformRefreshToken.findMany.mockResolvedValue([
      {
        familyId: 'family-a',
        userAgent: 'Mozilla/5.0 (Macintosh)',
        ipAddress: '203.0.113.7',
        lastUsedAt: new Date('2026-11-19T10:00:00Z'),
        expiresAt: new Date('2026-11-26T10:00:00Z'),
        revokedAt: null,
        createdAt: new Date('2026-11-19T10:00:00Z'),
      },
      {
        familyId: 'family-a',
        userAgent: 'Mozilla/5.0 (Macintosh)',
        ipAddress: '203.0.113.7',
        lastUsedAt: new Date('2026-11-19T09:00:00Z'),
        expiresAt: new Date('2026-11-26T09:00:00Z'),
        revokedAt: new Date('2026-11-19T10:00:00Z'),
        createdAt: new Date('2026-11-19T09:00:00Z'),
      },
      {
        familyId: 'family-b',
        userAgent: null,
        ipAddress: null,
        lastUsedAt: null,
        expiresAt: new Date('2026-11-25T08:00:00Z'),
        revokedAt: new Date('2026-11-19T08:30:00Z'),
        createdAt: new Date('2026-11-18T08:00:00Z'),
      },
    ]);

    const result = await service.listSessions(USER_ID);

    expect(result.data).toHaveLength(2);
    const [a, b] = result.data;
    expect(a.id).toBe('family-a');
    expect(a.userAgent).toBe('Mozilla/5.0 (Macintosh)');
    expect(a.ipAddress).toBe('203.0.113.7');
    expect(a.lastUsedAt).toEqual(new Date('2026-11-19T10:00:00Z'));
    expect(a.createdAt).toEqual(new Date('2026-11-19T09:00:00Z'));
    expect(a.expiresAt).toEqual(new Date('2026-11-26T10:00:00Z'));
    expect(a.revoked).toBe(false);
    expect(a.tokenCount).toBe(2);
    // Fully revoked family, no metadata: last-used falls back to createdAt.
    expect(b.id).toBe('family-b');
    expect(b.userAgent).toBeNull();
    expect(b.revoked).toBe(true);
    expect(b.lastUsedAt).toEqual(new Date('2026-11-18T08:00:00Z'));
  });

  it('refuses a session list for a missing user', async () => {
    const { service, prisma } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue(null);
    await expect(service.listSessions(USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('revokes a whole session family and audits it', async () => {
    const { service, prisma, audit, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
    });
    prisma.platformRefreshToken.findMany.mockResolvedValue([
      { id: 'row-1' },
      { id: 'row-2' },
    ]);
    prisma.platformRefreshToken.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.revokeSession(USER_ID, 'family-a', ADMIN_ID);

    expect(result).toEqual({ success: true, revokedCount: 1 });
    expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, familyId: 'family-a', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: 'users.session.revoke',
        entity: 'PlatformRefreshToken',
        entityId: 'family-a',
        after: { userId: USER_ID, revokedCount: 1 },
      }),
    );
  });

  it('revoking an unknown session 404s', async () => {
    const { service, prisma, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
    });
    prisma.platformRefreshToken.findMany.mockResolvedValue([]);
    await expect(
      service.revokeSession(USER_ID, 'no-such-family', ADMIN_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resets TOTP for another user, audits the reason, never returns a secret', async () => {
    const { service, prisma, audit, mfa, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue({
      ...admin,
      id: USER_ID,
    });

    const result = await service.resetTotp(USER_ID, ADMIN_ID, {
      reason: 'Lost authenticator device',
    });

    expect(result).toEqual({ success: true });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(mfa.clearMfa).toHaveBeenCalledWith(USER_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: 'users.totp.reset',
        entityId: USER_ID,
        after: {
          sessionsRevoked: true,
          reason: 'Lost authenticator device',
        },
      }),
    );
  });

  it('refuses a TOTP self-reset with 403 and a missing user with 404', async () => {
    const { service, prisma, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue(admin);
    await expect(
      service.resetTotp(ADMIN_ID, ADMIN_ID, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.platformUser.findUnique.mockResolvedValue(null);
    await expect(
      service.resetTotp(USER_ID, ADMIN_ID, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('invites a user, replaces a pending invite and emails the accept link', async () => {
    const { service, prisma, mail, audit } = makeService();

    const result = await service.invite(
      { email: 'Invite@Ecomate.Test', name: 'Invited', role: 'SUPPORT' } as any,
      ADMIN_ID,
    );

    expect(prisma.platformUserInvite.deleteMany).toHaveBeenCalledWith({
      where: { email: 'invite@ecomate.test', usedAt: null },
    });
    const created = prisma.platformUserInvite.create.mock.calls[0][0].data;
    expect(created.email).toBe('invite@ecomate.test');
    expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mail.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'invite@ecomate.test',
        role: 'SUPPORT',
        acceptUrl: expect.stringMatching(
          /^https:\/\/saas\.ecomate\.test\/accept-invite\?token=[a-f0-9]{64}$/,
        ),
      }),
    );
    // The emailed token hashes to the stored hash.
    const emailed = mail.sendInvite.mock.calls[0][0].acceptUrl as string;
    const rawToken = emailed.split('token=')[1];
    expect(createHash('sha256').update(rawToken).digest('hex')).toBe(
      created.tokenHash,
    );
    expect(result.delivered).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'users.invite' }),
    );
  });

  it('refuses to invite an existing user', async () => {
    const { service, prisma, admin } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue(admin);

    await expect(
      service.invite(
        { email: 'admin@ecomate.test', name: 'X', role: 'SUPPORT' } as any,
        ADMIN_ID,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps the invite and returns the accept link when the send fails', async () => {
    const { service, prisma, mail, audit } = makeService();
    prisma.platformUser.findUnique.mockResolvedValue(null);
    mail.sendInvite.mockRejectedValue(new Error('SMTP down'));

    const result = await service.invite(
      { email: 'new@ecomate.test', name: 'X', role: 'SUPPORT' } as any,
      ADMIN_ID,
    );

    // The invite is NOT deleted and the call does NOT throw (F5): the
    // operator gets the link to share manually until SMTP is configured.
    expect(prisma.platformUserInvite.delete).not.toHaveBeenCalled();
    expect(result.delivered).toBe(false);
    expect(result.acceptUrl).toMatch(
      /^https:\/\/saas\.ecomate\.test\/accept-invite\?token=[a-f0-9]{64}$/,
    );
    expect(result.deliveryError).toBe('SMTP down');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'users.invite',
        after: expect.objectContaining({ delivered: false }),
      }),
    );
  });

  it('accepts an invite, creates the user and marks the invite used', async () => {
    const { service, prisma, audit } = makeService();
    prisma.platformUserInvite.findUnique.mockResolvedValue({
      id: 'invite-1',
      email: 'invited@ecomate.test',
      name: 'Invited',
      role: 'BILLING',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 3600_000),
      usedAt: null,
    });

    const result = await service.acceptInvite({
      token: 'raw-token',
      password: 'a-very-long-password',
    } as any);

    expect(result).toEqual({ success: true });
    const created = prisma.platformUser.create.mock.calls[0][0].data;
    expect(created.email).toBe('invited@ecomate.test');
    expect(created.role).toBe('BILLING');
    expect(
      await bcrypt.compare('a-very-long-password', created.passwordHash),
    ).toBe(true);
    expect(prisma.platformUserInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'users.invite.accept' }),
    );
  });

  it('rejects missing, used and expired invites with one message', async () => {
    const { service, prisma } = makeService();

    prisma.platformUserInvite.findUnique.mockResolvedValue(null);
    await expect(
      service.acceptInvite({ token: 'nope', password: 'x'.repeat(12) } as any),
    ).rejects.toThrow('Invalid or expired invite');

    prisma.platformUserInvite.findUnique.mockResolvedValue({
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await expect(
      service.acceptInvite({ token: 'used', password: 'x'.repeat(12) } as any),
    ).rejects.toThrow('Invalid or expired invite');

    prisma.platformUserInvite.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      service.acceptInvite({
        token: 'old',
        password: 'x'.repeat(12),
      } as any),
    ).rejects.toThrow('Invalid or expired invite');
  });

  it('lists pending invites and revokes one', async () => {
    const { service, prisma, audit } = makeService();
    prisma.platformUserInvite.findMany.mockResolvedValue([
      { id: 'invite-1', email: 'a@test.com' },
    ]);

    const listed = await service.listInvites();
    expect(listed.data).toHaveLength(1);
    expect(prisma.platformUserInvite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usedAt: null, expiresAt: { gt: expect.any(Date) } },
      }),
    );

    prisma.platformUserInvite.findUnique.mockResolvedValue({
      id: 'invite-1',
      email: 'a@test.com',
      role: 'SUPPORT',
    });
    const revoked = await service.revokeInvite('invite-1', ADMIN_ID);
    expect(revoked).toEqual({ success: true });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'users.invite.revoke' }),
    );

    prisma.platformUserInvite.findUnique.mockResolvedValue(null);
    await expect(
      service.revokeInvite('missing', ADMIN_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the role matrix', () => {
    const { service } = makeService();

    const { roles } = service.getRoles();

    expect(roles.map((r: any) => r.role)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
      'READONLY',
    ]);
    const readonly = roles.find((r: any) => r.role === 'READONLY');
    expect(
      readonly.capabilities.every((c: any) => c.access === 'none'),
    ).toBe(true);
  });
});
