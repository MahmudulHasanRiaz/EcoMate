import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../common/audit.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { CentralAuthClient, CentralAuthError } from '../auth/central-auth.client';
import { isCentralAuthMode } from '../auth/console-auth-mode';
import { MfaService } from '../auth/mfa.service';
import { DomainConfigService } from '../config/domain-config.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { ResetMfaDto } from './dto/reset-mfa.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ROLE_MATRIX } from './role-matrix';

/** Invite links live 72 hours. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

/** Fields safe to return for a platform user — never passwordHash/mfaSecret. */
const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  avatarKey: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly mail: PlatformMailService,
    private readonly mfa: MfaService,
    private readonly domainConfig: DomainConfigService,
    private readonly centralAuth?: CentralAuthClient,
  ) {}

  /**
   * The central client is optional in the constructor so unit specs can
   * construct the service without it; every central-mode call throws a
   * clear error when it is absent (the Nest module always provides it
   * — AuthModule is @Global and exports CentralAuthClient).
   */
  private requireCentral(): CentralAuthClient {
    if (!this.centralAuth) {
      throw new Error(
        'Central auth client is not configured (CONSOLE_AUTH_MODE=central-ba needs it)',
      );
    }
    return this.centralAuth;
  }

  /**
   * Map a central-service failure onto the console-facing exception.
   * 409 (email already a central user) → Conflict; transport/5xx →
   * 503; anything else → 500 with the service's message (a desynced
   * operator must surface as failed, never as silent success).
   */
  private centralError(err: unknown, action: string): Error {
    if (err instanceof CentralAuthError && err.status === 409) {
      return new ConflictException(
        `A central user with this email already exists (${action})`,
      );
    }
    if (err instanceof ServiceUnavailableException) return err;
    return new InternalServerErrorException(
      `Central auth ${action} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  getRoles() {
    return { roles: ROLE_MATRIX };
  }

  async list(query: {
    page?: string;
    limit?: string;
    role?: string;
    status?: string;
    search?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const search = query.search?.trim();

    const where: any = {};
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.platformUser.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: userSelect,
      }),
      this.prisma.platformUser.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async detail(id: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id },
      select: userSelect,
    });
    if (!user) throw new NotFoundException('Platform user not found');
    return user;
  }

  async create(dto: CreateUserDto, actorId: string) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.platformUser.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('A platform user with this email exists');
    }

    // Central-ba mode: the central user is created FIRST (its id is
    // server-generated), role-synced, and the PlatformUser row is then
    // created WITH id = the central id — preserving the Phase 2
    // invariant PlatformUser.id == central user id (AuditLog.actorId
    // relies on it). If the central create fails, no PlatformUser row
    // is created (no orphan). POST /internal/users takes no
    // platformRole, so the role-sync call is mandatory, not optional.
    let centralId: string | undefined;
    if (isCentralAuthMode()) {
      const central = this.requireCentral();
      try {
        const created = await central.createCentralUser({
          email,
          name: dto.name.trim(),
          password: dto.password,
          emailVerified: true,
        });
        centralId = created.id;
        await central.roleSync(created.id, dto.role);
      } catch (err) {
        throw this.centralError(err, 'create user');
      }
    }

    const user = await this.prisma.platformUser.create({
      data: {
        ...(centralId ? { id: centralId } : {}),
        email,
        name: dto.name.trim(),
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, 12),
      },
      select: userSelect,
    });

    await this.audit.record({
      actorId,
      action: 'users.create',
      entity: 'PlatformUser',
      entityId: user.id,
      after: { email: user.email, name: user.name, role: user.role },
    });
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    const current = await this.prisma.platformUser.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Platform user not found');

    const demotes =
      dto.role !== undefined && dto.role !== current.role;
    const disables =
      dto.status !== undefined && dto.status !== current.status;
    if (id === actorId && (demotes || disables)) {
      throw new BadRequestException(
        'You cannot change your own role or status',
      );
    }
    if (
      current.role === 'SUPERADMIN' &&
      current.status === 'ACTIVE' &&
      ((demotes && dto.role !== 'SUPERADMIN') ||
        (disables && dto.status !== 'ACTIVE'))
    ) {
      await this.assertNotLastSuperadmin(id);
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;

    const user = await this.prisma.platformUser.update({
      where: { id },
      data,
      select: userSelect,
    });

    await this.audit.record({
      actorId,
      action: 'users.update',
      entity: 'PlatformUser',
      entityId: user.id,
      before: {
        name: current.name,
        role: current.role,
        status: current.status,
      },
      after: { name: user.name, role: user.role, status: user.status },
    });

    // Central-ba mode: a role change must reach the central user the
    // same call (the BA `role` — operator vs user — gates impersonation,
    // so a desynced operator can or cannot impersonate wrongly). A
    // failed sync surfaces as a 500 + audit — never silent success.
    // A disable also revokes the operator's central sessions (a
    // disabled operator must not keep a live BA session).
    if (isCentralAuthMode()) {
      const central = this.requireCentral();
      if (demotes) {
        try {
          await central.roleSync(id, user.role);
        } catch (err) {
          await this.audit.record({
            actorId,
            action: 'users.role-sync.failed',
            entity: 'PlatformUser',
            entityId: id,
            after: {
              role: user.role,
              error: err instanceof Error ? err.message : String(err),
            },
          });
          throw this.centralError(err, 'sync role');
        }
      }
      if (disables && dto.status === 'DISABLED') {
        try {
          await central.revokeAllSessions(id);
        } catch (err) {
          await this.audit.record({
            actorId,
            action: 'users.sessions.revoke.failed',
            entity: 'PlatformUser',
            entityId: id,
            after: {
              error: err instanceof Error ? err.message : String(err),
            },
          });
          throw this.centralError(err, 'revoke sessions');
        }
      }
    }
    return user;
  }

  async remove(id: string, actorId: string) {
    const current = await this.prisma.platformUser.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Platform user not found');
    if (id === actorId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    if (current.status !== 'DISABLED') {
      throw new ConflictException(
        'Disable the account first, then delete it',
      );
    }

    // Central-ba mode: delete the central user FIRST, then the platform
    // row — so a failure leaves the operator visible, not half-deleted.
    // A central 404 is tolerated (already gone). Central delete cascades
    // the user's BA sessions at the DB level, so no separate revoke-all
    // is needed here.
    if (isCentralAuthMode()) {
      try {
        await this.requireCentral().deleteCentralUser(id);
      } catch (err) {
        throw this.centralError(err, 'delete user');
      }
    }

    await this.prisma.platformUser.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'users.delete',
      entity: 'PlatformUser',
      entityId: id,
      before: {
        email: current.email,
        name: current.name,
        role: current.role,
      },
    });
    return { success: true };
  }

  async resetPassword(id: string, actorId: string) {
    const current = await this.prisma.platformUser.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Platform user not found');
    if (id === actorId) {
      throw new BadRequestException(
        'Use change-password for your own account',
      );
    }

    const temporaryPassword = randomBytes(12).toString('base64url');
    // Central-ba mode: the temp password lands centrally FIRST (so a
    // central failure leaves the local password untouched and the call
    // fails cleanly), then the local bcrypt update + local token revoke.
    // BA's revoke-on-password-reset only fires for BA-native resets,
    // so the central sessions are revoked explicitly afterwards.
    if (isCentralAuthMode()) {
      const central = this.requireCentral();
      try {
        await central.updateCentralUser(id, { password: temporaryPassword });
        await central.revokeAllSessions(id);
      } catch (err) {
        throw this.centralError(err, 'reset password');
      }
    }
    await this.prisma.$transaction([
      this.prisma.platformUser.update({
        where: { id },
        data: { passwordHash: await bcrypt.hash(temporaryPassword, 12) },
      }),
      this.prisma.platformRefreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorId,
      action: 'users.password.reset',
      entity: 'PlatformUser',
      entityId: id,
      after: { sessionsRevoked: true },
    });
    // Returned once — the admin shares it out of band. Never audited/logged.
    return { temporaryPassword };
  }

  /**
   * Unified SUPERADMIN-only MFA reset for a lost device / locked-out
   * operator (Phase 4: the old `POST /users/:id/totp/reset` is folded
   * into this endpoint; the `totp/reset` route and `resetTotp()` are
   * deleted). Clears all MFA state and revokes sessions; a SUPERADMIN
   * target must re-enroll at next login (enforced), other roles log in
   * without MFA until they enroll again. Self-reset is refused with
   * 400 — use the account page. The optional `reason` is audit metadata
   * only (kept from the old totp/reset body — the users page sends it).
   *
   * Central-ba mode: the BA-side reset
   * (`POST /internal/users/:id/mfa/reset` — clears the twoFactor row +
   * `twoFactorEnabled = false`) runs first, plus a central revoke-all;
   * the local `clearMfa` still runs so the legacy columns stay in sync
   * for a rollback.
   */
  async resetMfa(id: string, actorId: string, dto: ResetMfaDto = {}) {
    const current = await this.prisma.platformUser.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Platform user not found');
    if (id === actorId) {
      throw new BadRequestException(
        'Use the MFA section on your own account page to manage your own MFA',
      );
    }

    if (isCentralAuthMode()) {
      const central = this.requireCentral();
      try {
        await central.resetMfaCentral(id);
        await central.revokeAllSessions(id);
      } catch (err) {
        throw this.centralError(err, 'reset MFA');
      }
    }

    await this.mfa.clearMfa(id);
    const reason = dto.reason?.trim();
    await this.audit.record({
      actorId,
      action: 'users.mfa.reset',
      entity: 'PlatformUser',
      entityId: id,
      after: {
        sessionsRevoked: true,
        ...(reason ? { reason } : {}),
      },
    });
    return { success: true };
  }

  /**
   * Per-operator session list (CMS item 15).
   *
   * Legacy mode: a session is one refresh-token rotation family
   * (familyId): one login mints a family, every refresh keeps it. Rows
   * are grouped per family; device/IP come from the newest row that
   * carries them, lastUsedAt is the newest activity, expiry is the
   * newest live token's expiry (or the newest overall when revoked).
   *
   * Central-ba mode: the BA session list (one login = one row, no
   * rotation family). `id` is the BA session id (the revoke key) and
   * `tokenCount` has no BA equivalent, so it is dropped. SUPERADMIN
   * only (controller) — sessions reveal device/IP, so they stay with
   * the role that already manages users.
   */
  async listSessions(id: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id },
    });
    if (!user) throw new NotFoundException('Platform user not found');

    if (isCentralAuthMode()) {
      let rows: Awaited<
        ReturnType<CentralAuthClient['listCentralSessions']>
      >;
      try {
        rows = await this.requireCentral().listCentralSessions(id);
      } catch (err) {
        throw this.centralError(err, 'list sessions');
      }
      const sessions = (rows.data ?? []).map((s) => ({
        id: s.id,
        userAgent: s.userAgent ?? null,
        ipAddress: s.ipAddress ?? null,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt ?? null,
        expiresAt: s.expiresAt,
        revoked: s.revoked ?? false,
      }));
      sessions.sort(
        (a, b) =>
          (b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0) -
          (a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0),
      );
      return { data: sessions };
    }

    const rows = await this.prisma.platformRefreshToken.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        familyId: true,
        userAgent: true,
        ipAddress: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    const byFamily = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byFamily.get(row.familyId);
      if (list) list.push(row);
      else byFamily.set(row.familyId, [row]);
    }

    const sessions = [...byFamily.entries()].map(([familyId, family]) => {
      // Rows arrive newest-first; the newest row carrying metadata wins.
      const withMeta = family.find((r) => r.userAgent || r.ipAddress);
      const live = family.filter((r) => !r.revokedAt);
      const lastUsed = family.reduce<Date | null>((max, r) => {
        const at = r.lastUsedAt ?? r.createdAt;
        return !max || at > max ? at : max;
      }, null);
      const created = family.reduce<Date>(
        (min, r) => (r.createdAt < min ? r.createdAt : min),
        family[0].createdAt,
      );
      const pool = live.length > 0 ? live : family;
      const expires = pool.reduce<Date>(
        (max, r) => (r.expiresAt > max ? r.expiresAt : max),
        pool[0].expiresAt,
      );
      return {
        id: familyId,
        userAgent: withMeta?.userAgent ?? null,
        ipAddress: withMeta?.ipAddress ?? null,
        createdAt: created,
        lastUsedAt: lastUsed,
        expiresAt: expires,
        revoked: live.length === 0,
        tokenCount: family.length,
      };
    });
    sessions.sort(
      (a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0),
    );
    return { data: sessions };
  }

  /**
   * Revoke one session.
   *
   * Legacy mode: kills the WHOLE rotation family (consistent with the
   * replay-revokes-family rule in AuthService.refresh), so every token
   * minted by that login stops working. Audited. Idempotent: revoking
   * an already-revoked family succeeds with revokedCount 0.
   *
   * Central-ba mode: revokes the single BA session by id. A 404 from
   * the central service (unknown session) surfaces as NotFound.
   */
  async revokeSession(id: string, sessionId: string, actorId: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id },
    });
    if (!user) throw new NotFoundException('Platform user not found');

    if (isCentralAuthMode()) {
      try {
        await this.requireCentral().revokeCentralSession(id, sessionId);
      } catch (err) {
        if (err instanceof CentralAuthError && err.status === 404) {
          throw new NotFoundException('Session not found');
        }
        throw this.centralError(err, 'revoke session');
      }
      await this.audit.record({
        actorId,
        action: 'users.session.revoke',
        entity: 'Session',
        entityId: sessionId,
        after: { userId: id, revokedCount: 1 },
      });
      return { success: true, revokedCount: 1 };
    }

    const rows = await this.prisma.platformRefreshToken.findMany({
      where: { userId: id, familyId: sessionId },
      select: { id: true },
    });
    if (rows.length === 0) {
      throw new NotFoundException('Session not found');
    }
    const { count } = await this.prisma.platformRefreshToken.updateMany({
      where: { userId: id, familyId: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: 'users.session.revoke',
      entity: 'PlatformRefreshToken',
      entityId: sessionId,
      after: { userId: id, revokedCount: count },
    });
    return { success: true, revokedCount: count };
  }

  async invite(dto: InviteUserDto, actorId: string) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.platformUser.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('A platform user with this email exists');
    }

    // Resend = replace the pending invite (one live invite per email).
    await this.prisma.platformUserInvite.deleteMany({
      where: { email, usedAt: null },
    });

    const token = randomBytes(32).toString('hex');
    const invite = await this.prisma.platformUserInvite.create({
      data: {
        email,
        name: dto.name.trim(),
        role: dto.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        createdById: actorId,
      },
    });

    const acceptUrl = `${this.adminBaseUrl()}/accept-invite?token=${token}`;
    let delivered = false;
    let deliveryError: string | null = null;
    try {
      ({ delivered } = await this.mail.sendInvite({
        to: email,
        name: dto.name.trim(),
        role: dto.role,
        acceptUrl,
      }));
    } catch (err) {
      // A failed send must NOT delete the invite (F5): with SMTP
      // unconfigured the old code deleted the row and threw, so the
      // operator saw only a red banner, the invitee got nothing, and no
      // pending invite existed to resend or revoke. The invite is kept and
      // the accept URL is returned so the operator can share the link
      // manually until SMTP is configured.
      delivered = false;
      deliveryError = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Invite email for ${email} failed (${deliveryError}); invite kept, accept link returned to the operator`,
      );
    }

    await this.audit.record({
      actorId,
      action: 'users.invite',
      entity: 'PlatformUserInvite',
      entityId: invite.id,
      after: {
        email,
        name: invite.name,
        role: invite.role,
        delivered,
        deliveryError,
      },
    });
    return {
      id: invite.id,
      email: invite.email,
      name: invite.name,
      role: invite.role,
      expiresAt: invite.expiresAt,
      delivered,
      // Only when undelivered: the operator shares this link manually.
      ...(delivered ? {} : { acceptUrl, deliveryError }),
    };
  }

  async listInvites() {
    const invites = await this.prisma.platformUserInvite.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return { data: invites };
  }

  async revokeInvite(id: string, actorId: string) {
    const invite = await this.prisma.platformUserInvite.findUnique({
      where: { id },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    await this.prisma.platformUserInvite.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'users.invite.revoke',
      entity: 'PlatformUserInvite',
      entityId: id,
      before: { email: invite.email, role: invite.role },
    });
    return { success: true };
  }

  async acceptInvite(dto: AcceptInviteDto) {
    const invite = await this.prisma.platformUserInvite.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    // One message for missing/used/expired — never leak which.
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired invite');
    }
    const existing = await this.prisma.platformUser.findUnique({
      where: { email: invite.email },
    });
    if (existing) {
      throw new ConflictException('A platform user with this email exists');
    }

    // Central-ba mode: the central user is created FIRST (its id is
    // server-generated), role-synced, and the PlatformUser row is then
    // created WITH id = the central id (same invariant as create()).
    // If the central create fails, no PlatformUser row is created and
    // the invite stays unused, so the invitee can retry.
    let centralId: string | undefined;
    if (isCentralAuthMode()) {
      const central = this.requireCentral();
      try {
        const created = await central.createCentralUser({
          email: invite.email,
          name: (dto.name ?? invite.name).trim(),
          password: dto.password,
          emailVerified: true,
        });
        centralId = created.id;
        await central.roleSync(created.id, invite.role);
      } catch (err) {
        throw this.centralError(err, 'create user');
      }
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.platformUser.create({
        data: {
          // Central-ba mode: the central user was created first (above)
          // and the PlatformUser row takes its id — the Phase 2
          // invariant. Legacy mode: the id is generated as before.
          ...(centralId ? { id: centralId } : {}),
          email: invite.email,
          name: (dto.name ?? invite.name).trim(),
          role: invite.role,
          passwordHash: await bcrypt.hash(dto.password, 12),
        },
        select: userSelect,
      });
      await tx.platformUserInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });
      return created;
    });

    await this.audit.record({
      actorId: user.id,
      action: 'users.invite.accept',
      entity: 'PlatformUser',
      entityId: user.id,
      after: { email: user.email, role: user.role },
    });
    return { success: true };
  }

  private adminBaseUrl(): string {
    // UI-managed console URL (DomainConfig.adminUrl): the stored
    // override, else https://{console host}. PLATFORM_ADMIN_URL env
    // remains only as the bootstrap value for the config.
    return this.domainConfig.adminUrl().replace(/\/$/, '');
  }

  private async assertNotLastSuperadmin(excludeUserId: string) {
    const remaining = await this.prisma.platformUser.count({
      where: {
        role: 'SUPERADMIN',
        status: 'ACTIVE',
        id: { not: excludeUserId },
      },
    });
    if (remaining === 0) {
      throw new ConflictException(
        'Cannot remove the last active superadmin',
      );
    }
  }
}
