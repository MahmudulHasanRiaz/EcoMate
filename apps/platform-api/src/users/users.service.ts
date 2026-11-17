import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../common/audit.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { MfaService } from '../auth/mfa.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
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
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly mail: PlatformMailService,
    private readonly mfa: MfaService,
  ) {}

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

    const user = await this.prisma.platformUser.create({
      data: {
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
   * SUPERADMIN-only MFA reset for a lost device / locked-out operator.
   * Clears all MFA state and revokes sessions; a SUPERADMIN target must
   * re-enroll at next login (enforced), other roles log in without MFA
   * until they enroll again. Self-reset is refused — use the account page.
   */
  async resetMfa(id: string, actorId: string) {
    const current = await this.prisma.platformUser.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Platform user not found');
    if (id === actorId) {
      throw new BadRequestException(
        'Use the MFA section on your own account page to manage your own MFA',
      );
    }

    await this.mfa.clearMfa(id);
    await this.audit.record({
      actorId,
      action: 'users.mfa.reset',
      entity: 'PlatformUser',
      entityId: id,
      after: { sessionsRevoked: true },
    });
    return { success: true };
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
    try {
      ({ delivered } = await this.mail.sendInvite({
        to: email,
        name: dto.name.trim(),
        role: dto.role,
        acceptUrl,
      }));
    } catch (err) {
      // A failed send leaves no orphan invite behind.
      await this.prisma.platformUserInvite.delete({
        where: { id: invite.id },
      });
      throw err;
    }

    await this.audit.record({
      actorId,
      action: 'users.invite',
      entity: 'PlatformUserInvite',
      entityId: invite.id,
      after: { email, name: invite.name, role: invite.role, delivered },
    });
    return {
      id: invite.id,
      email: invite.email,
      name: invite.name,
      role: invite.role,
      expiresAt: invite.expiresAt,
      delivered,
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

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.platformUser.create({
        data: {
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
    const base =
      process.env.PLATFORM_ADMIN_URL || 'http://localhost:5174';
    return base.replace(/\/$/, '');
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
