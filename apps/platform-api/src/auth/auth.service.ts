import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

export interface PlatformSessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface LoginMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PlatformSessionUser;
}

export interface MfaChallenge {
  mfaRequired: true;
  /** Short-lived token authorising the second step / MFA setup only. */
  mfaToken: string;
  /** True when the account must enroll before it can log in (SUPERADMIN). */
  mfaSetupRequired: boolean;
}

export type LoginResult = SessionTokens | MfaChallenge;

/** Consecutive failures before the account locks. */
export const LOGIN_LOCKOUT_THRESHOLD = 5;
/** Longest lockout, in minutes (progressive doubling caps here). */
export const LOGIN_LOCKOUT_MAX_MINUTES = 240;
/** Grace window in which replaying a just-rotated refresh token is a plain
 * 401 (covers the console's concurrent-refresh race) instead of a family
 * revoke. */
export const REFRESH_REUSE_GRACE_MS = 30_000;
/** User-Agent strings are capped at this length when stored on a token. */
export const SESSION_USER_AGENT_MAX_LENGTH = 512;

/** Precomputed bcrypt hash used for unknown emails, so a login attempt
 * against a nonexistent account costs the same time as a real password
 * check (no user-enumeration oracle). */
const DUMMY_PASSWORD_HASH =
  '$2b$12$y1hnfdAEzVI/TZ1Bvzp9LuKYDsScmJ.jSyYFzqr3qobbeStpvDwkW';

/** Progressive lockout: 5 failures -> 5 min, doubling per failure, capped. */
export function lockoutMinutesFor(failedCount: number): number {
  if (failedCount < LOGIN_LOCKOUT_THRESHOLD) return 0;
  return Math.min(
    5 * 2 ** (failedCount - LOGIN_LOCKOUT_THRESHOLD),
    LOGIN_LOCKOUT_MAX_MINUTES,
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  private accessSecret(): string {
    const secret = process.env.PLATFORM_JWT_SECRET;
    if (!secret) throw new Error('PLATFORM_JWT_SECRET is not set');
    return secret;
  }

  private refreshSecret(): string {
    const secret = process.env.PLATFORM_JWT_REFRESH_SECRET;
    if (!secret) throw new Error('PLATFORM_JWT_REFRESH_SECRET is not set');
    return secret;
  }

  private accessTtlSeconds(): number {
    return Number(process.env.PLATFORM_JWT_EXPIRES_IN_SECONDS ?? 900);
  }

  private refreshTtlSeconds(): number {
    return Number(process.env.PLATFORM_JWT_REFRESH_EXPIRES_IN_SECONDS ?? 604800);
  }

  private mfaTokenTtlSeconds(): number {
    return Number(process.env.PLATFORM_MFA_TOKEN_TTL_SECONDS ?? 300);
  }

  private reuseGraceMs(): number {
    return Number(
      process.env.PLATFORM_REFRESH_REUSE_GRACE_MS ?? REFRESH_REUSE_GRACE_MS,
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokens(
    user: PlatformSessionUser,
    familyId?: string,
    meta: LoginMeta = {},
  ) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, type: 'platform' },
      { secret: this.accessSecret(), expiresIn: this.accessTtlSeconds() },
    );

    const tokenJti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: tokenJti, type: 'platform-refresh' },
      { secret: this.refreshSecret(), expiresIn: this.refreshTtlSeconds() },
    );
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds() * 1000);

    await this.prisma.platformRefreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        // A fresh login starts a family; a refresh keeps the family's id.
        familyId: familyId ?? randomUUID(),
        expiresAt,
        // Session metadata for the per-operator session list (CMS item
        // 15): device/IP from this request, last-used is now.
        userAgent: meta.userAgent?.slice(0, SESSION_USER_AGENT_MAX_LENGTH) ?? null,
        ipAddress: meta.ip ?? null,
        lastUsedAt: new Date(),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtlSeconds(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  private async issueMfaToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, jti: randomUUID(), type: 'platform-mfa' },
      { secret: this.accessSecret(), expiresIn: this.mfaTokenTtlSeconds() },
    );
  }

  /** Verify a short-lived MFA token; returns the user id it was minted for. */
  async verifyMfaToken(mfaToken: string): Promise<string> {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(mfaToken, {
        secret: this.accessSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }
    if (payload?.type !== 'platform-mfa' || !payload.sub) {
      throw new UnauthorizedException('Invalid MFA token');
    }
    return payload.sub as string;
  }

  /** Throw 423 when the account is inside a lockout window. */
  assertNotLocked(user: { lockedUntil: Date | null }): void {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        'Too many failed login attempts. This account is temporarily locked.',
        423,
      );
    }
  }

  /**
   * Record a failed login: bump the consecutive-failure counter and, at or
   * past the threshold, lock the account for a progressively longer window.
   * Returns the new counter and lockout (if any) for the audit record.
   */
  async recordFailedLogin(
    user: { id: string; failedLoginCount: number | null },
    meta: LoginMeta,
    reason: string,
  ): Promise<{ failedLoginCount: number; lockedUntil: Date | null }> {
    const failedLoginCount = (user.failedLoginCount ?? 0) + 1;
    const minutes = lockoutMinutesFor(failedLoginCount);
    const lockedUntil =
      minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { failedLoginCount, lockedUntil },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'auth.login.failed',
      entity: 'PlatformUser',
      entityId: user.id,
      after: {
        reason,
        failedLoginCount,
        lockedUntil: lockedUntil?.toISOString() ?? null,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { failedLoginCount, lockedUntil };
  }

  /** Clear the failure counter after a successful login. */
  private async recordSuccessfulLogin(
    user: PlatformSessionUser,
    meta: LoginMeta,
  ): Promise<void> {
    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'auth.login.success',
      entity: 'PlatformUser',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async login(dto: LoginDto, meta: LoginMeta = {}): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.platformUser.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') {
      // Same cost as a real password check: no enumeration oracle.
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      await this.audit.record({
        actorId: user?.id ?? null,
        action: 'auth.login.failed',
        entity: 'PlatformUser',
        entityId: user?.id ?? null,
        after: { reason: user ? 'disabled' : 'unknown', email },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Invalid platform credentials');
    }

    this.assertNotLocked(user);

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await this.recordFailedLogin(user, meta, 'bad_password');
      throw new UnauthorizedException('Invalid platform credentials');
    }

    const sessionUser: PlatformSessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    // MFA second step: enrolled users must prove a code; SUPERADMIN
    // accounts without MFA must enroll before proceeding (D4).
    if (user.mfaEnabledAt) {
      return {
        mfaRequired: true,
        mfaToken: await this.issueMfaToken(user.id),
        mfaSetupRequired: false,
      };
    }
    if (user.role === 'SUPERADMIN') {
      return {
        mfaRequired: true,
        mfaToken: await this.issueMfaToken(user.id),
        mfaSetupRequired: true,
      };
    }

    await this.recordSuccessfulLogin(sessionUser, meta);
    return this.issueTokens(sessionUser, undefined, meta);
  }

  /**
   * Finish a login after the MFA second step (code verified, or setup just
   * completed): resets the failure counter, audits success, issues tokens.
   */
  async completeMfaLogin(
    userId: string,
    meta: LoginMeta = {},
  ): Promise<SessionTokens> {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform account is not active');
    }
    this.assertNotLocked(user);
    const sessionUser: PlatformSessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    await this.recordSuccessfulLogin(sessionUser, meta);
    return this.issueTokens(sessionUser, undefined, meta);
  }

  async refresh(refreshToken: string, meta: LoginMeta = {}) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload?.type !== 'platform-refresh' || !payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const row = await this.prisma.platformRefreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
    });
    if (!row || row.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }
    if (row.revokedAt) {
      // Reuse detection: presenting an already-rotated token means the
      // token (or its family) was stolen — revoke the whole family. A
      // replay inside the short grace window is the console's
      // concurrent-refresh race, not theft: plain 401, no revoke.
      const ageMs = Date.now() - row.revokedAt.getTime();
      if (ageMs > this.reuseGraceMs()) {
        await this.prisma.platformRefreshToken.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.record({
          actorId: row.userId,
          action: 'auth.refresh.reuse',
          entity: 'PlatformRefreshToken',
          entityId: row.id,
          after: { familyId: row.familyId, sessionsRevoked: true },
        });
      }
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const user = await this.prisma.platformUser.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform account is not active');
    }

    await this.prisma.platformRefreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });

    // The rotated token keeps the family's device/IP when this request
    // carries none (e.g. a client without a User-Agent header), and
    // lastUsedAt moves to now — the session stays recognisable.
    return this.issueTokens(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      row.familyId,
      {
        ip: meta.ip ?? row.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? row.userAgent ?? undefined,
      },
    );
  }

  async logout(refreshToken: string) {
    const hash = this.hashToken(refreshToken);
    await this.prisma.platformRefreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform account is not active');
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    await this.prisma.$transaction([
      this.prisma.platformUser.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) },
      }),
      this.prisma.platformRefreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorId: userId,
      action: 'auth.password.change',
      entity: 'PlatformUser',
      entityId: userId,
      after: { sessionsRevoked: true },
    });
    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        lastLoginAt: true,
        mfaEnabledAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('Platform account not found');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: !!user.mfaEnabledAt,
      mfaRequired: user.role === 'SUPERADMIN',
    };
  }
}
