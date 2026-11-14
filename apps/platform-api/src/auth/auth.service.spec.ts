import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';

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
};

const jwt = new JwtService({});
const service = new AuthService(prisma, jwt);

const ORIGINAL_ENV = { ...process.env };

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

describe('AuthService', () => {
  beforeAll(() => {
    process.env.PLATFORM_JWT_SECRET = 'test-platform-access-secret';
    process.env.PLATFORM_JWT_REFRESH_SECRET = 'test-platform-refresh-secret';
    process.env.PLATFORM_JWT_EXPIRES_IN_SECONDS = '900';
    process.env.PLATFORM_JWT_REFRESH_EXPIRES_IN_SECONDS = '604800';
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

  it('logs in an active platform user and stores a refresh-token hash', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    prisma.platformUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@ecomate.test',
      name: 'Platform Admin',
      role: 'SUPERADMIN',
      status: 'ACTIVE',
      passwordHash,
    });

    const result = await service.login({
      email: 'ADMIN@ecomate.test',
      password: 'correct-password',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.user).toMatchObject({
      id: 'user-1',
      email: 'admin@ecomate.test',
      role: 'SUPERADMIN',
    });
    expect(prisma.platformUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(prisma.platformRefreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          tokenHash: expect.any(String),
        }),
      }),
    );
  });

  it('rejects a wrong password', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    prisma.platformUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@ecomate.test',
      name: 'Platform Admin',
      role: 'SUPERADMIN',
      status: 'ACTIVE',
      passwordHash,
    });

    await expect(
      service.login({ email: 'admin@ecomate.test', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a disabled platform user', async () => {
    prisma.platformUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@ecomate.test',
      name: 'Platform Admin',
      role: 'SUPERADMIN',
      status: 'DISABLED',
      passwordHash: 'irrelevant',
    });

    await expect(
      service.login({ email: 'admin@ecomate.test', password: 'anything' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates a valid refresh token and revokes the old row', async () => {
    const refreshToken = await jwt.signAsync(
      { sub: 'user-1', jti: 'jti-1', type: 'platform-refresh' },
      { secret: process.env.PLATFORM_JWT_REFRESH_SECRET, expiresIn: 60 },
    );
    prisma.platformRefreshToken.findUnique.mockResolvedValue({
      id: 'row-1',
      userId: 'user-1',
      tokenHash: hashToken(refreshToken),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.platformUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@ecomate.test',
      name: 'Platform Admin',
      role: 'SUPERADMIN',
      status: 'ACTIVE',
    });

    const result = await service.refresh(refreshToken);

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).not.toBe(refreshToken);
    expect(prisma.platformRefreshToken.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects a revoked refresh token', async () => {
    const refreshToken = await jwt.signAsync(
      { sub: 'user-1', jti: 'jti-1', type: 'platform-refresh' },
      { secret: process.env.PLATFORM_JWT_REFRESH_SECRET, expiresIn: 60 },
    );
    prisma.platformRefreshToken.findUnique.mockResolvedValue({
      id: 'row-1',
      userId: 'user-1',
      tokenHash: hashToken(refreshToken),
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('revokes a refresh token on logout', async () => {
    await service.logout('some-refresh-token');
    expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
