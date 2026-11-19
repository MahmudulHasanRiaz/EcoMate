import { HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import {
  AuthService,
  LOGIN_LOCKOUT_THRESHOLD,
  lockoutMinutesFor,
} from './auth.service';

const prisma: any = {
  platformUser: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  platformRefreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(async (input: any) => Promise.all(input)),
};

const audit: any = { record: jest.fn().mockResolvedValue(undefined) };

const jwt = new JwtService({});
const service = new AuthService(prisma, jwt, audit);

const ORIGINAL_ENV = { ...process.env };

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'admin@ecomate.test',
    name: 'Platform Admin',
    role: 'BILLING',
    status: 'ACTIVE',
    passwordHash: '',
    failedLoginCount: 0,
    lockedUntil: null,
    mfaEnabledAt: null,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    ...overrides,
  };
}

describe('AuthService', () => {
  beforeAll(() => {
    process.env.PLATFORM_JWT_SECRET = 'test-platform-access-secret';
    process.env.PLATFORM_JWT_REFRESH_SECRET = 'test-platform-refresh-secret';
    process.env.PLATFORM_JWT_EXPIRES_IN_SECONDS = '900';
    process.env.PLATFORM_JWT_REFRESH_EXPIRES_IN_SECONDS = '604800';
    process.env.PLATFORM_MFA_TOKEN_TTL_SECONDS = '300';
    process.env.PLATFORM_REFRESH_REUSE_GRACE_MS = '30000';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.platformUser.update.mockResolvedValue({});
    prisma.platformRefreshToken.create.mockResolvedValue({});
    prisma.platformRefreshToken.update.mockResolvedValue({});
    prisma.platformRefreshToken.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('lockout schedule', () => {
    it('locks progressively: 5 min, doubling, capped at 240', () => {
      expect(lockoutMinutesFor(4)).toBe(0);
      expect(lockoutMinutesFor(5)).toBe(5);
      expect(lockoutMinutesFor(6)).toBe(10);
      expect(lockoutMinutesFor(7)).toBe(20);
      expect(lockoutMinutesFor(10)).toBe(160);
      expect(lockoutMinutesFor(11)).toBe(240);
      expect(lockoutMinutesFor(99)).toBe(240);
    });
  });

  describe('login', () => {
    it('logs in an active non-SUPERADMIN without MFA, audits success, resets the counter', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ passwordHash, failedLoginCount: 2 }),
      );

      const result = await service.login(
        { email: 'ADMIN@ecomate.test', password: 'correct-password' },
        { ip: '1.2.3.4', userAgent: 'spec' },
      );

      expect('accessToken' in result).toBe(true);
      const tokens = result as { accessToken: string; refreshToken: string };
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(prisma.platformUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.platformRefreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tokenHash: expect.any(String),
            familyId: expect.any(String),
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'auth.login.success',
          ip: '1.2.3.4',
          userAgent: 'spec',
        }),
      );
    });

    it('records device/IP/last-used on the refresh token at login', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ passwordHash }),
      );

      await service.login(
        { email: 'admin@ecomate.test', password: 'correct-password' },
        { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (X11; Linux)' },
      );

      expect(prisma.platformRefreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userAgent: 'Mozilla/5.0 (X11; Linux)',
            ipAddress: '203.0.113.9',
            lastUsedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('caps a long User-Agent at 512 chars on the token row', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ passwordHash }),
      );

      await service.login(
        { email: 'admin@ecomate.test', password: 'correct-password' },
        { ip: '203.0.113.9', userAgent: 'A'.repeat(600) },
      );

      const data = prisma.platformRefreshToken.create.mock.calls[0][0].data;
      expect(data.userAgent).toHaveLength(512);
    });

    it('returns an MFA challenge for an enrolled user instead of tokens', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ passwordHash, mfaEnabledAt: new Date() }),
      );

      const result = await service.login({
        email: 'admin@ecomate.test',
        password: 'correct-password',
      });

      expect(result).toMatchObject({
        mfaRequired: true,
        mfaSetupRequired: false,
      });
      expect((result as { mfaToken: string }).mfaToken).toBeDefined();
      expect(prisma.platformRefreshToken.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login.success' }),
      );
    });

    it('forces a SUPERADMIN without MFA into setup instead of logging in', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ passwordHash, role: 'SUPERADMIN' }),
      );

      const result = await service.login({
        email: 'admin@ecomate.test',
        password: 'correct-password',
      });

      expect(result).toMatchObject({
        mfaRequired: true,
        mfaSetupRequired: true,
      });
      expect(prisma.platformRefreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects a wrong password, counts the failure and audits it', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ passwordHash, failedLoginCount: 1 }),
      );

      await expect(
        service.login({
          email: 'admin@ecomate.test',
          password: 'wrong-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.platformUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginCount: 2, lockedUntil: null },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'auth.login.failed',
          after: expect.objectContaining({
            reason: 'bad_password',
            failedLoginCount: 2,
          }),
        }),
      );
    });

    it('locks the account at the threshold and refuses logins with 423', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({
          passwordHash,
          failedLoginCount: LOGIN_LOCKOUT_THRESHOLD - 1,
        }),
      );

      await expect(
        service.login({
          email: 'admin@ecomate.test',
          password: 'wrong-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const data = prisma.platformUser.update.mock.calls[0][0].data;
      expect(data.failedLoginCount).toBe(LOGIN_LOCKOUT_THRESHOLD);
      expect(data.lockedUntil).toBeInstanceOf(Date);
      expect(data.lockedUntil.getTime()).toBeGreaterThan(Date.now());

      // Locked: even the correct password gets 423, without a bcrypt check
      // against the stored hash (no new audit of the password itself).
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({
          passwordHash,
          failedLoginCount: LOGIN_LOCKOUT_THRESHOLD,
          lockedUntil: new Date(Date.now() + 60_000),
        }),
      );
      const err = await service
        .login({ email: 'admin@ecomate.test', password: 'correct-password' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.status).toBe(423);
    });

    it('rejects an unknown email with 401 and audits it without an actor', async () => {
      prisma.platformUser.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@ecomate.test', password: 'anything' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          action: 'auth.login.failed',
          after: expect.objectContaining({ reason: 'unknown' }),
        }),
      );
    });

    it('rejects a disabled platform user', async () => {
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ status: 'DISABLED', passwordHash: 'irrelevant' }),
      );

      await expect(
        service.login({ email: 'admin@ecomate.test', password: 'anything' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('completeMfaLogin', () => {
    it('issues tokens, resets the counter and audits success', async () => {
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ failedLoginCount: 3, mfaEnabledAt: new Date() }),
      );

      const result = await service.completeMfaLogin('user-1', {
        ip: '1.2.3.4',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(prisma.platformUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failedLoginCount: 0,
            lockedUntil: null,
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'auth.login.success',
        }),
      );
    });

    it('refuses a locked account', async () => {
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ lockedUntil: new Date(Date.now() + 60_000) }),
      );
      const err = await service
        .completeMfaLogin('user-1')
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.status).toBe(423);
    });
  });

  describe('mfa tokens', () => {
    it('mints and verifies a platform-mfa token, rejects other types', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.platformUser.findUnique.mockResolvedValue(
        activeUser({ passwordHash, mfaEnabledAt: new Date() }),
      );
      const result = (await service.login({
        email: 'admin@ecomate.test',
        password: 'correct-password',
      })) as { mfaToken: string };
      await expect(service.verifyMfaToken(result.mfaToken)).resolves.toBe(
        'user-1',
      );
      await expect(service.verifyMfaToken('garbage')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // A session access token is not an MFA token.
      const access = await jwt.signAsync(
        { sub: 'user-1', type: 'platform' },
        { secret: process.env.PLATFORM_JWT_SECRET, expiresIn: 60 },
      );
      await expect(service.verifyMfaToken(access)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('refresh', () => {
    function signedRefresh() {
      return jwt.signAsync(
        { sub: 'user-1', jti: 'jti-1', type: 'platform-refresh' },
        { secret: process.env.PLATFORM_JWT_REFRESH_SECRET, expiresIn: 60 },
      );
    }

    it('rotates a valid refresh token, revokes the old row, keeps the family', async () => {
      const refreshToken = await signedRefresh();
      prisma.platformRefreshToken.findUnique.mockResolvedValue({
        id: 'row-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: hashToken(refreshToken),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.platformUser.findUnique.mockResolvedValue(activeUser());

      const result = await service.refresh(refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).not.toBe(refreshToken);
      expect(prisma.platformRefreshToken.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.platformRefreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ familyId: 'family-1' }),
        }),
      );
    });

    it('carries device/IP to the rotated token and refreshes lastUsedAt', async () => {
      const refreshToken = await signedRefresh();
      prisma.platformRefreshToken.findUnique.mockResolvedValue({
        id: 'row-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: hashToken(refreshToken),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        userAgent: 'Mozilla/5.0 (Macintosh)',
        ipAddress: '203.0.113.7',
      });
      prisma.platformUser.findUnique.mockResolvedValue(activeUser());

      // No metadata on this refresh request: the family keeps its own.
      await service.refresh(refreshToken, {});

      expect(prisma.platformRefreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            familyId: 'family-1',
            userAgent: 'Mozilla/5.0 (Macintosh)',
            ipAddress: '203.0.113.7',
            lastUsedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('updates device/IP on refresh when the request carries new ones', async () => {
      const refreshToken = await signedRefresh();
      prisma.platformRefreshToken.findUnique.mockResolvedValue({
        id: 'row-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: hashToken(refreshToken),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        userAgent: 'Mozilla/5.0 (Macintosh)',
        ipAddress: '203.0.113.7',
      });
      prisma.platformUser.findUnique.mockResolvedValue(activeUser());

      await service.refresh(refreshToken, {
        ip: '198.51.100.2',
        userAgent: 'curl/8.0',
      });

      expect(prisma.platformRefreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userAgent: 'curl/8.0',
            ipAddress: '198.51.100.2',
          }),
        }),
      );
    });

    it('revokes the whole family when a long-revoked token is replayed', async () => {
      const refreshToken = await signedRefresh();
      prisma.platformRefreshToken.findUnique.mockResolvedValue({
        id: 'row-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: hashToken(refreshToken),
        revokedAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'auth.refresh.reuse',
          after: expect.objectContaining({ familyId: 'family-1' }),
        }),
      );
    });

    it('does NOT revoke the family for a replay inside the grace window', async () => {
      const refreshToken = await signedRefresh();
      prisma.platformRefreshToken.findUnique.mockResolvedValue({
        id: 'row-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: hashToken(refreshToken),
        revokedAt: new Date(Date.now() - 5_000),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.platformRefreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.refresh.reuse' }),
      );
    });

    it('rejects an unknown refresh token', async () => {
      const refreshToken = await signedRefresh();
      prisma.platformRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  it('revokes a refresh token on logout', async () => {
    await service.logout('some-refresh-token');
    expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('changes a password, revokes all sessions and audits it', async () => {
    const passwordHash = await bcrypt.hash('old-password-123', 4);
    prisma.platformUser.findUnique.mockResolvedValue(
      activeUser({ passwordHash }),
    );

    const result = await service.changePassword('user-1', {
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
    });

    expect(result).toEqual({ success: true });
    const data = prisma.platformUser.update.mock.calls[0][0].data;
    expect(await bcrypt.compare('new-password-456', data.passwordHash)).toBe(
      true,
    );
    expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'auth.password.change',
        entity: 'PlatformUser',
      }),
    );
  });

  it('rejects a wrong current password and a reused password', async () => {
    const passwordHash = await bcrypt.hash('old-password-123', 4);
    prisma.platformUser.findUnique.mockResolvedValue(
      activeUser({ passwordHash }),
    );

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'not-the-password',
        newPassword: 'new-password-456',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'old-password-123',
        newPassword: 'old-password-123',
      }),
    ).rejects.toThrow('must be different');
  });

  it('me() reports MFA state and the SUPERADMIN requirement', async () => {
    prisma.platformUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@ecomate.test',
      name: 'Platform Admin',
      role: 'SUPERADMIN',
      status: 'ACTIVE',
      lastLoginAt: null,
      mfaEnabledAt: new Date(),
    });
    await expect(service.me('user-1')).resolves.toMatchObject({
      mfaEnabled: true,
      mfaRequired: true,
    });

    prisma.platformUser.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'billing@ecomate.test',
      name: 'Billing',
      role: 'BILLING',
      status: 'ACTIVE',
      lastLoginAt: null,
      mfaEnabledAt: null,
    });
    await expect(service.me('user-2')).resolves.toMatchObject({
      mfaEnabled: false,
      mfaRequired: false,
    });
  });
});
