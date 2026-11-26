import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { CentralAuthClient } from './central-auth.client';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

export interface PlatformSessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Custom avatar object key (null = Gravatar/initials fallback). */
  avatarKey: string | null;
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
    private readonly centralAuth?: CentralAuthClient,
  ) {}

  /**
   * The central client is optional in the constructor so unit specs can
   * construct the service without it; every central-mode method throws
   * a clear error when it is absent (the Nest module always provides
   * it — see AuthModule).
   */
  private requireCentral(): CentralAuthClient {
    if (!this.centralAuth) {
      throw new Error(
        'Central auth client is not configured (CONSOLE_AUTH_MODE=central-ba needs it)',
      );
    }
    return this.centralAuth;
  }

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
        avatarKey: user.avatarKey,
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
      avatarKey: user.avatarKey,
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
      avatarKey: user.avatarKey,
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
        avatarKey: user.avatarKey,
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

  /**
   * Central-ba mode change-password: BA `changePassword` first (with
   * revoke-other-sessions), then the local bcrypt update + local
   * refresh-token revoke in the same step, so a rollback to custom-jwt
   * still sees the new password. A BA failure (wrong current password
   * → 401) leaves the local row untouched. Audits the same action as
   * the legacy path.
   */
  async changePasswordCentral(
    userId: string,
    dto: ChangePasswordDto,
    cookie: string | undefined,
    host: string | undefined,
  ) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform account is not active');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    await this.requireCentral().changeCentralPassword(
      cookie,
      host,
      dto.currentPassword,
      dto.newPassword,
    );

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

  /**
   * Central-ba mode logout shim (scripts + the legacy branch): signs
   * the BA session out via the forwarded cookies and revokes any local
   * refresh tokens for the same user. Best-effort on the BA side — an
   * auth-service outage still revokes the local tokens and reports
   * success (the console's own logout path in central mode is BA
   * `signOut` from the browser, not this shim). No cookie → nothing to
   * revoke, still `{ success: true }` (idempotent, like the legacy
   * path).
   */
  async logoutCentral(cookie: string | undefined, host: string | undefined) {
    const central = this.requireCentral();
    let userId: string | undefined;
    try {
      const session = await central.getSession(cookie, host);
      userId = session?.user?.id;
      if (userId) {
        await central.signOutCentral(cookie, host);
      }
    } catch (err) {
      // Outage: the BA session cannot be revoked right now; the local
      // tokens below are still revoked, and the caller reports success.
      // Logged (not swallowed silently) so an operator can see it.
      // eslint-disable-next-line no-console
      console.warn(
        `[auth] central logout: BA sign-out failed (${err instanceof Error ? err.message : String(err)}); local tokens still revoked`,
      );
    }
    if (userId) {
      await this.prisma.platformRefreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  async me(userId: string, twoFactorEnabled?: boolean) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        avatarKey: true,
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
      avatarKey: user.avatarKey,
      lastLoginAt: user.lastLoginAt,
      // In central-ba mode the caller passes BA's `twoFactorEnabled`
      // (the guard stashed the verified session); otherwise the local
      // enrolment flag. The response shape is unchanged either way.
      mfaEnabled:
        twoFactorEnabled !== undefined
          ? twoFactorEnabled
          : !!user.mfaEnabledAt,
      mfaRequired: user.role === 'SUPERADMIN',
    };
  }

  /**
   * PATCH /auth/me — avatar only. The caller passes a media-library
   * asset id (from the MediaPicker) or null to remove the custom photo;
   * the API stores the asset's object KEY, never a URL (StackMate M-23).
   * The key embeds a random UUID, so it doubles as the unguessable token
   * for the public serve endpoint GET /public/avatar/:userId?k=<key>.
   * Returns the updated /me view.
   */
  async updateMe(
    userId: string,
    dto: { avatarAssetId?: string | null },
  ) {
    const current = await this.prisma.platformUser.findUnique({
      where: { id: userId },
      select: { id: true, avatarKey: true },
    });
    if (!current) {
      throw new UnauthorizedException('Platform account not found');
    }
    if (dto.avatarAssetId === undefined) return this.me(userId);

    let avatarKey: string | null = null;
    if (dto.avatarAssetId !== null) {
      const asset = await this.prisma.mediaAsset.findUnique({
        where: { id: dto.avatarAssetId },
        select: { objectKey: true, mimeType: true },
      });
      if (!asset) {
        throw new NotFoundException('Media asset not found');
      }
      if (!asset.mimeType.toLowerCase().startsWith('image/')) {
        throw new BadRequestException('Avatar must be an image');
      }
      avatarKey = asset.objectKey;
    }

    await this.prisma.platformUser.update({
      where: { id: userId },
      data: { avatarKey },
    });
    // Audit key PRESENCE, never the key value — it is a capability token.
    await this.audit.record({
      actorId: userId,
      action: 'auth.avatar.update',
      entity: 'PlatformUser',
      entityId: userId,
      before: { avatarSet: current.avatarKey !== null },
      after: { avatarSet: avatarKey !== null },
    });
    return this.me(userId);
  }
}
