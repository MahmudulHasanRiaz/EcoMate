// Phase 3 central-auth cutover — parity: the legacy flows are 410 Gone
// in central-ba mode, the central branches work, and the
// assertNotImpersonated gates fire for BA-mapped impersonated users.
//
// NOTE on scope: the OTP *password-reset* flow dies in central mode
// (D7=B). The EMAIL_VERIFICATION OTP flow is a SEPARATE flow the plan
// never decides — it stays live in both modes (open Boss decision); the
// verifyEmail central branch below proves it.
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CentralAuthClient } from './central-auth.client';
import { PosAnalyticsController } from '../pos-analytics/pos-analytics.controller';
import { assertNotImpersonated } from '../common/utils/impersonation';

jest.mock('better-auth/crypto', () => ({
  hashPassword: jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('central-auth parity (TENANT_AUTH_MODE=central-ba)', () => {
  let service: AuthService;
  let prisma: any;
  let centralAuth: jest.Mocked<CentralAuthClient>;
  const ORIGINAL_MODE = process.env['TENANT_AUTH_MODE'];

  const mockUser = {
    id: 'user-1',
    email: 'owner@example.com',
    role: 'admin',
    firstName: 'Owner',
    lastName: 'One',
    username: 'owner1',
    phoneNumber: '+8801712345678',
    password: 'hashed',
    status: 'active',
    betterAuthUserId: 'central-user-1',
    emailVerified: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  beforeEach(async () => {
    process.env['TENANT_AUTH_MODE'] = 'central-ba';
    centralAuth = {
      changeCentralPassword: jest.fn().mockResolvedValue(undefined),
      updateCentralUser: jest.fn().mockResolvedValue({}),
      createCentralUser: jest.fn(),
      deleteCentralUser: jest.fn(),
      getCentralUserById: jest.fn(),
      getCentralUserByEmail: jest.fn(),
      searchCentralUsers: jest.fn(),
      getSession: jest.fn(),
      listOrganizations: jest.fn(),
      getOrganizationMember: jest.fn(),
      resolveTenantIdForOrg: jest.fn(() => 'tenant-1'),
    } as unknown as jest.Mocked<CentralAuthClient>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            userProfile: {
              findFirst: jest.fn(),
              update: jest.fn(),
            },
            refreshToken: {
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
            verificationToken: {
              create: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            customerProfile: { upsert: jest.fn() },
            userSettings: { create: jest.fn() },
            employee: { findFirst: jest.fn() },
            betterAuthUser: { findFirst: jest.fn() },
          },
        },
        { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn() } },
        {
          provide: EmailService,
          useValue: {
            sendOtp: jest.fn().mockResolvedValue(undefined),
            sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CentralAuthClient, useValue: centralAuth },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (ORIGINAL_MODE === undefined) delete process.env['TENANT_AUTH_MODE'];
    else process.env['TENANT_AUTH_MODE'] = ORIGINAL_MODE;
  });

  it.each([
    ['register', () => service.register({} as any)],
    ['login', () => service.login({ email: 'a@b.c', password: 'x' } as any)],
    ['token refresh', () => service.refresh('user-1', 'tok')],
    ['logout', () => service.logout('user-1', 'tok')],
    ['forgot-password', () => service.forgotPassword('a@b.c')],
    ['verify-otp', () => service.verifyOtp('a@b.c', '123456')],
    ['reset-password', () => service.resetPassword('tok', 'new-password-1')],
  ])('legacy flow %s → 410 Gone in central-ba mode', async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ status: 410 });
  });

  it('legacy flows work again when the flag flips back to legacy-jwt', async () => {
    process.env['TENANT_AUTH_MODE'] = 'legacy-jwt';
    // forgotPassword with no matching user returns the generic message
    // (no OTP sent) — proving the legacy branch runs again.
    prisma.userProfile.findFirst.mockResolvedValue(null);
    await expect(service.forgotPassword('nobody@example.com')).resolves.toEqual({
      message: 'If the email exists, a reset code has been sent',
    });
  });

  describe('changePassword (central branch, H9/H10)', () => {
    it('calls the central service with the forwarded session, syncs the legacy bcrypt row, deletes refresh tokens', async () => {
      prisma.userProfile.findFirst.mockResolvedValue(mockUser);
      prisma.userProfile.update.mockResolvedValue({ ...mockUser });
      const result = await service.changePassword(
        'user-1',
        { currentPassword: 'old-pass', newPassword: 'new-pass-1' },
        { cookie: 'session_token=tok', host: 'tenant1.faah.net' },
      );
      expect(result).toEqual({ message: 'Password changed successfully' });
      expect(centralAuth.changeCentralPassword).toHaveBeenCalledWith(
        'session_token=tok',
        'tenant1.faah.net',
        'old-pass',
        'new-pass-1',
      );
      expect(prisma.userProfile.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: '$2a$12$hashedpassword' },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('same-password is rejected before any central call', async () => {
      await expect(
        service.changePassword('user-1', {
          currentPassword: 'same-pass',
          newPassword: 'same-pass',
        }),
      ).rejects.toThrow('New password must be different');
      expect(centralAuth.changeCentralPassword).not.toHaveBeenCalled();
    });

    it('a central 401 propagates (no silent success)', async () => {
      prisma.userProfile.findFirst.mockResolvedValue(mockUser);
      centralAuth.changeCentralPassword.mockRejectedValue(
        new UnauthorizedException('Current session is not valid'),
      );
      await expect(
        service.changePassword('user-1', {
          currentPassword: 'wrong',
          newPassword: 'new-pass-1',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.userProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile / verifyEmail (central branches, H11/H13)', () => {
    it('updateProfile mirrors name/email to the central user, warn-and-swallow on failure', async () => {
      prisma.userProfile.findFirst
        .mockResolvedValueOnce(null) // email clash check
        .mockResolvedValueOnce({ ...mockUser, firstName: 'Owner', lastName: 'One' });
      prisma.userProfile.update.mockResolvedValue({
        ...mockUser,
        firstName: 'Owner',
        lastName: 'Two',
        email: 'new@example.com',
      });
      const updated = await service.updateProfile('user-1', {
        lastName: 'Two',
        email: 'new@example.com',
      } as any);
      expect(updated.email).toBe('new@example.com');
      expect(centralAuth.updateCentralUser).toHaveBeenCalledWith(
        'central-user-1',
        { name: 'Owner Two', email: 'new@example.com' },
      );

      // Central failure must not fail the response (H13).
      centralAuth.updateCentralUser.mockRejectedValueOnce(
        new Error('central down'),
      );
      // No email in this dto → a single findFirst (the user fetch).
      prisma.userProfile.findFirst.mockResolvedValueOnce({
        ...mockUser,
        firstName: 'Owner',
        lastName: 'One',
      });
      await expect(
        service.updateProfile('user-1', { lastName: 'Two' } as any),
      ).resolves.toBeDefined();
    });

    it('verifyEmail (EMAIL_VERIFICATION OTP) stays live in central mode and mirrors emailVerified centrally', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
        email: 'owner@example.com',
        type: 'EMAIL_VERIFICATION',
        usedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      prisma.userProfile.update.mockResolvedValue({
        ...mockUser,
        emailVerified: true,
      });
      const result = await service.verifyEmail('123456');
      expect(result).toEqual({ message: 'Email verified successfully' });
      expect(centralAuth.updateCentralUser).toHaveBeenCalledWith(
        'central-user-1',
        { emailVerified: true },
      );
      expect(prisma.verificationToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { usedAt: expect.any(Date) },
      });
    });
  });

  describe('assertNotImpersonated gates with BA-mapped impersonated users', () => {
    const baImpersonatedUser = {
      userId: 'user-1',
      impersonated: true,
      impersonationActor: 'central-admin-9', // central user id, not email
    };
    const ordinaryUser = { userId: 'user-1', impersonated: false };

    it('util fires for a BA-mapped impersonated user', () => {
      expect(() =>
        assertNotImpersonated(baImpersonatedUser, 'Password changes'),
      ).toThrow(ForbiddenException);
      expect(() =>
        assertNotImpersonated(ordinaryUser, 'Password changes'),
      ).not.toThrow();
    });

    it('auth.controller change-password gate blocks the BA-mapped impersonated user before the service runs', async () => {
      const authServiceMock = { changePassword: jest.fn() };
      const controller = new AuthController(
        authServiceMock as unknown as AuthService,
        {} as any,
      );
      await expect(
        controller.changePassword(
          baImpersonatedUser as any,
          { currentPassword: 'a', newPassword: 'b' } as any,
          { headers: {} } as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(authServiceMock.changePassword).not.toHaveBeenCalled();

      await controller.changePassword(
        ordinaryUser as any,
        { currentPassword: 'a', newPassword: 'b' } as any,
        { headers: { cookie: 'c', host: 'h' } } as any,
      );
      expect(authServiceMock.changePassword).toHaveBeenCalledWith(
        'user-1',
        { currentPassword: 'a', newPassword: 'b' },
        { cookie: 'c', host: 'h' },
      );
    });

    it('pos-analytics export gate blocks the BA-mapped impersonated user', async () => {
      const svcMock = { buildExport: jest.fn() };
      const controller = new PosAnalyticsController(svcMock as any);
      await expect(
        controller.export(
          undefined,
          baImpersonatedUser as any,
          {} as any,
          undefined,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(svcMock.buildExport).not.toHaveBeenCalled();
    });
  });
});
