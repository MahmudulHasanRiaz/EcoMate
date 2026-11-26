import { requireTenant, tenantCompound } from '../tenancy/tenant-context';
import {
  Injectable,
  Optional,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt, randomUUID, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { runPerTenant } from '../tenancy/tenant-job';
import { TenantRegistryService } from '../tenancy/tenant-registry.service';
import { schedulersEnabled } from '../common/worker-mode';
import { EmailService } from '../email/email.service';
import { baPrisma } from '../better-auth/prisma';
import { hashPassword } from 'better-auth/crypto';
import { CentralAuthClient } from './central-auth.client';
import { isCentralAuthMode } from '../common/tenant-auth-mode';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { normalizePhone } from '../common/utils/phone-utils';
import { loadEffectivePermissions } from '../common/permissions/permissions-loader';
import * as bcrypt from 'bcryptjs';
import ms from 'ms';
import type { StringValue } from 'ms';

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    @Optional()
    private readonly tenantRegistry?: TenantRegistryService,
    // Central auth client (global module). @Optional so unit tests that
    // construct the service by hand keep working; in central-ba mode the
    // client MUST be present (Nest injects it from CentralAuthModule).
    @Optional()
    private readonly centralAuth?: CentralAuthClient,
  ) {}

  /**
   * Central client or a fail-closed 503 (central mode without the client).
   */
  private requireCentralAuth(): CentralAuthClient {
    if (!this.centralAuth) {
      throw new ServiceUnavailableException(
        'Central auth client is not configured',
      );
    }
    return this.centralAuth;
  }

  /**
   * Phase 3 D7=B: the legacy JWT/OTP auth flows are gone in central-ba
   * mode — registration, login, token refresh, logout and the OTP
   * password reset all live on the central service now. They answer 410
   * Gone (not 404) so a stale client can tell "moved" from "missing".
   * The routes stay registered so legacy-jwt rollback works unchanged.
   */
  private requireLegacyAuthMode(flow: string): void {
    if (isCentralAuthMode()) {
      throw new HttpException(
        `${flow} is handled by the central auth service — use the Better Auth flow instead.`,
        HttpStatus.GONE,
      );
    }
  }

  async onModuleInit() {
    // Worker split (WORKER_MODE): the expired-token sweep is scheduler work
    // — the api process owns it. In `worker` mode this process only consumes
    // jobs. (The sweep is idempotent, so this is about single ownership,
    // not correctness.)
    if (!schedulersEnabled()) {
      this.logger.log(
        'Expired-token cleanup skipped (WORKER_MODE=worker — api owns scheduling)',
      );
      return;
    }
    await this.cleanupExpiredTokens();
    // Run cleanup every hour. The handle is kept so a hot reload / restart
    // cannot stack another sweep timer on top of a live one.
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredTokens().catch((err) =>
        this.logger.error('Failed to clean up expired refresh tokens', err),
      );
    }, 60 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private async cleanupExpiredTokens() {
    await runPerTenant(this.tenantRegistry, async () => {
      if (await this.prisma.isRestoreWriteBlocked()) return;

      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        this.logger.log(`Cleaned up ${count} expired refresh token(s)`);
      }
    });
  }

  async register(dto: RegisterDto) {
    this.requireLegacyAuthMode('Registration');
    const existingUser = await this.prisma.userProfile.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'User with this email or username already exists',
      );
    }

    const normalizedPhone = normalizePhone(dto.phoneNumber);
    if (!normalizedPhone) throw new BadRequestException('Invalid phone number');

    const [hashedPassword, baHashedPassword] = await Promise.all([
      bcrypt.hash(dto.password, 12),
      hashPassword(dto.password),
    ]);

    // Create BA user+account first, then UserProfile (saga pattern).
    // If downstream creation fails, roll back by deleting the BA user.
    const baUser = await baPrisma.betterAuthUser.create({
      data: {
        id: randomUUID(),
        name: `${dto.firstName} ${dto.lastName}`,
        email: dto.email,
        emailVerified: false,
        role: 'customer',
      },
    });

    try {
      await baPrisma.betterAuthAccount.create({
        data: {
          id: randomUUID(),
          userId: baUser.id,
          accountId: dto.email,
          providerId: 'email',
          password: baHashedPassword,
        },
      });

      const user = await this.prisma.userProfile.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          username: dto.username,
          email: dto.email,
          phoneNumber: normalizedPhone,
          password: hashedPassword,
          role: 'customer',
          betterAuthUserId: baUser.id,
        },
      });

      await this.prisma.userSettings.create({
        data: { userId: user.id },
      });

      // Create CustomerProfile (order FK references CustomerProfile)
      await this.prisma.customerProfile.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          betterAuthUserId: baUser.id,
          phone: normalizedPhone,
          email: dto.email,
          name: `${dto.firstName} ${dto.lastName}`.trim(),
        },
        update: {},
      });

      this.sendVerificationEmail(user.id).catch((err) =>
        this.logger.error(
          'Failed to send verification email after registration',
          err,
        ),
      );

      return this.generateTokens(user);
    } catch (err) {
      // Saga rollback: BA user was created but downstream creation failed.
      // Delete the BA user (account cascades) to keep the system consistent.
      await baPrisma.betterAuthUser
        .delete({ where: { id: baUser.id } })
        .catch((rollbackErr) =>
          this.logger.error(
            `Failed to rollback BA user ${baUser.id} after registration failure`,
            rollbackErr,
          ),
        );
      throw err;
    }
  }

  async login(dto: LoginDto) {
    this.requireLegacyAuthMode('Login');
    const user = await this.prisma.userProfile.findFirst({
      where: { email: dto.email },
    });

    if (!user) {
      this.logger.warn('Failed login attempt: user not found');
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      this.logger.warn('Failed login attempt: account not active');
      throw new UnauthorizedException('Account is not active');
    }

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      this.logger.warn('Failed login attempt: account locked');
      throw new UnauthorizedException(
        'Account is temporarily locked due to too many failed login attempts. Please try again later.',
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      // Increment failed attempts in one atomic operation
      // If this is the 5th attempt (attempts was 4), also lock the account
      const result = await this.prisma.userProfile.updateMany({
        where: {
          id: user.id,
          failedLoginAttempts: { lt: 4 },
        },
        data: {
          failedLoginAttempts: { increment: 1 },
          ...(user.failedLoginAttempts === 3
            ? { lockoutUntil: new Date(Date.now() + 15 * 60 * 1000) }
            : {}),
        },
      });

      // If result.count === 0, either user doesn't exist or attempts >= 4
      if (result.count === 0) {
        // Already at the limit — account should already be locked
        throw new UnauthorizedException(
          'Too many failed login attempts. Your account has been temporarily locked. Please try again later.',
        );
      }

      // If this was the lockout trigger attempt
      if (user.failedLoginAttempts === 3) {
        throw new UnauthorizedException(
          'Too many failed login attempts. Your account has been temporarily locked. Please try again later.',
        );
      }

      throw new UnauthorizedException('Invalid email or password');
    }

    // BA password migration: silently create BA user+account for legacy users
    if (!user.betterAuthUserId) {
      try {
        const baHashedPassword = await hashPassword(dto.password);
        const baUser = await baPrisma.betterAuthUser.create({
          data: {
            id: randomUUID(),
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            emailVerified: user.emailVerified,
            role: user.role,
          },
        });
        await baPrisma.betterAuthAccount.create({
          data: {
            id: randomUUID(),
            userId: baUser.id,
            accountId: user.email,
            providerId: 'email',
            password: baHashedPassword,
          },
        });
        await this.prisma.userProfile.update({
          where: { id: user.id },
          data: { betterAuthUserId: baUser.id },
        });
        this.logger.log(`BA user created for legacy user ${user.email}`);
      } catch (err) {
        this.logger.warn(`Failed to migrate user ${user.email} to BA`, err);
      }
    }

    const tokens = await this.generateTokens(user);

    // Reset failed login attempts on successful login
    if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
      await this.prisma.userProfile.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockoutUntil: null,
        },
      });
    }

    return tokens;
  }

  /**
   * Login for the ADMIN application only. Customer accounts are rejected
   * here with a clear message — a customer can still sign in to the
   * storefront through the universal /auth/login, but must never land in
   * the admin shell.
   *
   * The response also carries the computed permissions, so the admin layout
   * can gate menus immediately instead of waiting for the /auth/me round-trip.
   */
  async adminLogin(dto: LoginDto) {
    const result = await this.login(dto);

    if (result.user.role === 'customer') {
      // login() already minted a refresh token for this session — revoke it so
      // the rejected customer is left with no usable credentials.
      await this.prisma.refreshToken
        .delete({ where: { token: result.refreshToken } })
        .catch(() => null);
      throw new ForbiddenException(
        'You are signed in with a customer account. Customer accounts cannot access the admin application.',
      );
    }

    const profile = await this.prisma.userProfile.findFirst({
      where: { id: result.user.id },
    });
    const permissions = profile
      ? await this.computePermissionsForUser(profile)
      : [];

    return { ...result, user: { ...result.user, permissions } };
  }

  /**
   * Phase 3 R-8: delegates to the ONE permission loader (the same loader
   * the guards and the BA customSession plugin use), so the login
   * response and every request agree. DB errors propagate and surface
   * as 500, exactly as before.
   */
  async computePermissionsForUser(user: {
    role?: string | null;
    betterAuthUserId?: string | null;
  }): Promise<string[]> {
    return loadEffectivePermissions(this.prisma, {
      role: user.role,
      betterAuthUserId: user.betterAuthUserId,
    });
  }

  async refresh(userId: string, refreshToken: string) {
    this.requireLegacyAuthMode('Token refresh');
    // Atomically delete-and-check to prevent race conditions where two
    // concurrent refresh calls both pass findUnique before either delete.
    const deleted = await this.prisma.refreshToken
      .delete({ where: { token: refreshToken } })
      .catch(() => null);

    if (!deleted || deleted.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.userProfile.findFirst({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'active') {
      this.logger.warn('Failed token refresh: account not active');
      throw new UnauthorizedException('Account is not active');
    }

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      this.logger.warn('Failed token refresh: account locked');
      throw new UnauthorizedException(
        'Account is temporarily locked due to too many failed login attempts. Please try again later.',
      );
    }

    return this.generateTokens(user);
  }

  async logout(userId: string, refreshToken?: string, logoutAllDevices?: boolean) {
    this.requireLegacyAuthMode('Logout');
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { token: refreshToken, userId },
      });
    } else if (logoutAllDevices) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId },
      });
    }

    return { message: 'Logged out successfully' };
  }

  async me(userId: string) {
    const user = await this.prisma.userProfile.findFirst({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        phoneNumber: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        betterAuthUserId: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { betterAuthUserId, ...profile } = user;
    const isEmployee = betterAuthUserId
      ? !!(await this.prisma.employee.findFirst({
          where: { betterAuthUserId },
          select: { id: true },
        }))
      : false;

    return { ...profile, isEmployee };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: any = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) {
      const existing = await this.prisma.userProfile.findFirst({
        where: { email: dto.email },
        select: { id: true },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Email is already in use');
      }
      data.email = dto.email;
    }
    if (dto.phoneNumber !== undefined) {
      const normalized = normalizePhone(dto.phoneNumber);
      if (!normalized) throw new BadRequestException('Invalid phone number');
      data.phoneNumber = normalized;
    }

    const user = await this.prisma.userProfile.findFirst({
      where: { id: userId },
      select: {
        id: true,
        betterAuthUserId: true,
        firstName: true,
        lastName: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const updated = await this.prisma.userProfile.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        phoneNumber: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Sync to BA (legacy) or the central service (central-ba). H13:
    // profile-sync failures warn-and-swallow — they never fail the
    // response; the tenant row is already saved.
    if (user.betterAuthUserId) {
      if (isCentralAuthMode()) {
        try {
          const centralData: { name?: string; email?: string } = {};
          if (dto.email !== undefined) centralData.email = dto.email;
          if (dto.firstName !== undefined || dto.lastName !== undefined) {
            centralData.name = `${updated.firstName} ${updated.lastName}`;
          }
          if (Object.keys(centralData).length > 0) {
            await this.requireCentralAuth().updateCentralUser(
              user.betterAuthUserId,
              centralData,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Failed to sync profile to central auth for user ${userId}`,
            err,
          );
        }
      } else {
        try {
          const baData: any = {};
          if (dto.email !== undefined) baData.email = dto.email;
          if (dto.firstName !== undefined || dto.lastName !== undefined) {
            baData.name = `${updated.firstName} ${updated.lastName}`;
          }
          if (Object.keys(baData).length > 0) {
            await baPrisma.betterAuthUser.update({
              where: { id: user.betterAuthUserId },
              data: baData,
            });
          }
        } catch (err) {
          this.logger.warn(
            `Failed to sync profile to BA for user ${userId}`,
            err,
          );
        }
      }
    }

    return updated;
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    // Central mode only: the caller's session cookie + tenant Host, so
    // the service can authenticate the change-password call. The
    // controller forwards them from the request.
    authContext?: { cookie?: string; host?: string },
  ) {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const user = await this.prisma.userProfile.findFirst({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Phase 3 H9/H10: in central-ba mode the central service is
    // authoritative for the current-password check — no legacy bcrypt
    // check (the tenant row may hold a stale hash). The service call
    // revokes other sessions (revokeOtherSessions: true). The legacy
    // bcrypt row is still updated, warn-and-swallow (H13 — it is the
    // rollback path), and the legacy refresh tokens are deleted.
    if (isCentralAuthMode()) {
      await this.requireCentralAuth().changeCentralPassword(
        authContext?.cookie,
        authContext?.host,
        dto.currentPassword,
        dto.newPassword,
      );
      try {
        const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
        await this.prisma.userProfile.update({
          where: { id: userId },
          data: { password: hashedPassword },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to sync changed password to legacy row for user ${userId}`,
          err,
        );
      }
      await this.prisma.refreshToken.deleteMany({
        where: { userId },
      });
      return { message: 'Password changed successfully' };
    }

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.userProfile.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Sync password to BA if user has been migrated
    if (user.betterAuthUserId) {
      try {
        const baHashedPassword = await hashPassword(dto.newPassword);
        await baPrisma.betterAuthAccount.updateMany({
          where: { userId: user.betterAuthUserId, providerId: 'email' },
          data: { password: baHashedPassword },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to sync password to BA for user ${userId}`,
          err,
        );
      }
    }

    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string) {
    // Phase 3 D7=B: the OTP reset flow is dead in central-ba mode —
    // resets go through BA native reset links (frontend-driven). 410,
    // same as the other retired legacy flows above.
    this.requireLegacyAuthMode('Password reset');
    const user = await this.prisma.userProfile.findFirst({
      where: { email },
      select: { id: true },
    });
    if (user) {
      const rawToken = randomInt(100000, 999999).toString();
      const hashedToken = createHash('sha256')
        .update(rawToken + (process.env['JWT_SECRET'] || ''))
        .digest('hex');

      await this.prisma.verificationToken.create({
        data: {
          email,
          token: hashedToken,
          type: 'RESET_PASSWORD',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      await this.emailService.sendOtp(email, rawToken).catch((err) => {
        this.logger.error('Failed to send OTP email', err);
      });
    }
    return { message: 'If the email exists, a reset code has been sent' };
  }

  async verifyOtp(email: string, otp: string) {
    // Phase 3 D7=B: OTP reset is dead in central-ba mode (see
    // forgotPassword above). The EMAIL_VERIFICATION OTP flow is a
    // separate flow and stays live in both modes (open Boss decision).
    this.requireLegacyAuthMode('OTP verification');
    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: {
        email,
        type: 'RESET_PASSWORD',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const hashedOtp = createHash('sha256')
      .update(otp + (process.env['JWT_SECRET'] || ''))
      .digest('hex');
    const isOtpValid = hashedOtp === tokenRecord.token;
    if (!isOtpValid) {
      // SECURITY (2026-10-25, F23): 5 failed guesses invalidate EVERY
      // live OTP for this email — a 6-digit code with unlimited guesses
      // is not a secret. Below the threshold, count the failure.
      const attempts = (tokenRecord.failedAttempts ?? 0) + 1;
      if (attempts >= 5) {
        await this.prisma.verificationToken.updateMany({
          where: { email, type: 'RESET_PASSWORD', usedAt: null },
          data: { usedAt: new Date() },
        });
        throw new BadRequestException(
          'Too many failed attempts. Request a new code.',
        );
      }
      await this.prisma.verificationToken.update({
        where: { id: tokenRecord.id },
        data: { failedAttempts: attempts },
      });
      throw new BadRequestException('Invalid or expired OTP');
    }

    // SECURITY (2026-10-25, F23): consume on verify — the old code left
    // the OTP live, so one correct guess minted unlimited fresh reset
    // JWTs inside the 15-minute window. The reset step now trusts the
    // 5-minute reset JWT alone (see resetPassword).
    await this.prisma.verificationToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });

    const resetToken = this.jwtService.sign(
      { sub: tokenRecord.id, email },
      {
        secret: process.env['JWT_SECRET'],
        expiresIn: 300,
      },
    );

    return { resetToken };
  }

  async resetPassword(token: string, password: string) {
    this.requireLegacyAuthMode('Password reset');
    let payload: { sub: string; email: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env['JWT_SECRET'],
      });
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: { id: payload.sub },
    });

    // SECURITY (2026-10-25, F23): reset trusts the reset JWT alone. The
    // OTP record was already consumed at verify time, so requiring it
    // unused here would break every legitimate reset; the JWT's own
    // 5-minute expiry is the capability window.
    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const updatedUser = await this.prisma.userProfile.update({
      where: { tenantId_email: tenantCompound({  email: payload.email  }) },
      data: { password: hashedPassword },
    });

    await this.prisma.verificationToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });

    // Sync password to BA if user has been migrated
    if (updatedUser.betterAuthUserId) {
      try {
        const baHashedPassword = await hashPassword(password);
        await baPrisma.betterAuthAccount.updateMany({
          where: { userId: updatedUser.betterAuthUserId, providerId: 'email' },
          data: { password: baHashedPassword },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to sync reset password to BA for user ${updatedUser.id}`,
          err,
        );
      }
    }

    await this.prisma.refreshToken.deleteMany({
      where: { userId: updatedUser.id },
    });

    return { message: 'Password has been reset successfully' };
  }

  async sendVerificationEmail(userId: string) {
    const user = await this.prisma.userProfile.findFirst({
      where: { id: userId },
      select: { emailVerified: true, email: true },
    });
    if (!user || user.emailVerified) return;

    const rawToken = randomInt(100000, 999999).toString();
    const hashedToken = createHash('sha256')
      .update(rawToken + (process.env['JWT_SECRET'] || ''))
      .digest('hex');

    await this.prisma.verificationToken.create({
      data: {
        email: user.email,
        token: hashedToken,
        type: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await this.emailService.sendVerificationEmail(user.email, rawToken);
  }

  async verifyEmail(token: string) {
    const hashedToken = createHash('sha256')
      .update(token + (process.env['JWT_SECRET'] || ''))
      .digest('hex');
    const matched = await this.prisma.verificationToken.findFirst({
      where: {
        token: hashedToken,
        type: 'EMAIL_VERIFICATION',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!matched) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    const updatedUser = await this.prisma.userProfile.update({
      where: { tenantId_email: tenantCompound({  email: matched.email  }) },
      data: { emailVerified: true },
    });

    if (updatedUser.betterAuthUserId) {
      // EMAIL_VERIFICATION OTP stays live in both modes (open decision):
      // in central-ba mode the verification is mirrored to the central
      // user instead of the tenant BA row. Warn-and-swallow (H13).
      if (isCentralAuthMode()) {
        try {
          await this.requireCentralAuth().updateCentralUser(
            updatedUser.betterAuthUserId,
            { emailVerified: true },
          );
        } catch (err) {
          this.logger.warn(
            `Failed to sync email verification to central auth for user ${updatedUser.id}`,
            err,
          );
        }
      } else {
        try {
          await baPrisma.betterAuthUser.update({
            where: { id: updatedUser.betterAuthUserId },
            data: { emailVerified: true },
          });
        } catch (err) {
          this.logger.warn(
            `Failed to sync email verification to BA for user ${updatedUser.id}`,
            err,
          );
        }
      }
    }

    await this.prisma.verificationToken.update({
      where: { id: matched.id },
      data: { usedAt: new Date() },
    });

    return { message: 'Email verified successfully' };
  }

  private async generateTokens(user: {
    id: string;
    email: string;
    role: string;
    betterAuthUserId?: string | null;
  }) {
    const accessExpiresIn = (process.env['JWT_EXPIRES_IN'] ||
      '60m') as StringValue;
    const refreshExpiresIn = (process.env['JWT_REFRESH_EXPIRES_IN'] ||
      '7d') as StringValue;

    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email, role: user.role },
      {
        secret: process.env['JWT_SECRET'],
        expiresIn: ms(accessExpiresIn) / 1000,
      },
    );

    // A per-session `jti` is required, not cosmetic. Without it, two logins
    // for the same account inside the same clock second produce a
    // byte-identical refresh token ({sub, email} + matching iat/exp), and the
    // second insert violates RefreshToken.token's @unique — the user sees
    // "A record with this value already exists" (409) instead of a session.
    // Revoking a session also only worked by accident: the stored row was
    // keyed to a token shared by every session started in that second.
    const refreshToken = this.jwtService.sign(
      { sub: user.id, email: user.email, jti: randomUUID() },
      {
        secret: process.env['JWT_REFRESH_SECRET'],
        expiresIn: ms(refreshExpiresIn) / 1000,
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + ms(refreshExpiresIn)),
      },
    });

    const isEmployee = user.betterAuthUserId
      ? !!(await this.prisma.employee.findFirst({
          where: { betterAuthUserId: user.betterAuthUserId },
          select: { id: true },
        }))
      : false;

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isEmployee,
      },
    };
  }
}
