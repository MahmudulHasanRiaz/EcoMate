import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { normalizePhone } from '../common/utils/phone-utils';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { UserRole, UserStatus } from '@prisma/client';
import { baPrisma } from '../better-auth/prisma';
import { hashPassword } from 'better-auth/crypto';
import {
  CentralAuthClient,
  mapUserRoleToOrgRole,
} from '../auth/central-auth.client';
import { isCentralAuthMode } from '../common/tenant-auth-mode';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    // Central auth client (global module). @Optional so unit tests that
    // construct the service by hand keep working; in central-ba mode it
    // MUST be present (Nest injects it from CentralAuthModule).
    @Optional()
    private readonly centralAuth?: CentralAuthClient,
  ) {}

  /** Central client or a fail-closed 503 (central mode without the client). */
  private requireCentralAuth(): CentralAuthClient {
    if (!this.centralAuth) {
      throw new ServiceUnavailableException(
        'Central auth client is not configured',
      );
    }
    return this.centralAuth;
  }

  private readonly ALLOWED_SORT_FIELDS = [
    'createdAt',
    'updatedAt',
    'firstName',
    'lastName',
    'email',
    'username',
    'role',
    'status',
  ];

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    status?: string;
    role?: string;
    sort?: string;
    order?: string;
  }) {
    const page = Math.max(query.page || 1, 1);
    const perPage = Math.min(Math.max(query.perPage || 10, 1), 100);
    const skip = (page - 1) * perPage;

    const where: any = {};
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.role) {
      if (query.role === 'all_except_customer') {
        where.role = { not: 'customer' };
      } else if (query.role !== 'all') {
        where.role = query.role;
      }
    }

    const orderBy: any = {};
    const sortField =
      query.sort && this.ALLOWED_SORT_FIELDS.includes(query.sort)
        ? query.sort
        : 'createdAt';
    const sortOrder = query.order === 'asc' ? 'asc' : 'desc';
    orderBy[sortField] = sortOrder;

    const [users, total] = await Promise.all([
      this.prisma.userProfile.findMany({
        where,
        skip,
        take: perPage,
        orderBy,
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
      }),
      this.prisma.userProfile.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findByEmail(email: string) {
    const user = await this.prisma.userProfile.findFirst({
      where: { email },
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

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findOne(id: string) {
    const user = await this.prisma.userProfile.findFirst({
      where: { id },
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

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(dto: CreateUserDto) {
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

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // Phase 3: in central-ba mode the central user is created FIRST (the
    // service's internal endpoint — never baPrisma), then the profile is
    // linked to it inside the tx. A tx failure deletes the central user
    // again (saga, mirroring AuthService.register). The legacy bcrypt
    // row keeps being written in both modes (dual-write stays on until
    // Phase 5). Central emails are globally unique: an email that
    // belongs to another tenant's user surfaces as a 409 here.
    let centralUserId: string | undefined;
    if (isCentralAuthMode()) {
      const client = this.requireCentralAuth();
      const orgRole = mapUserRoleToOrgRole(dto.role);
      try {
        const central = await client.createCentralUser({
          email: dto.email,
          name: `${dto.firstName} ${dto.lastName}`,
          password: dto.password,
          ...(orgRole
            ? {
                organizationId: client.resolveTenantIdForOrg(),
                orgRole,
              }
            : {}),
        });
        centralUserId = central.id;
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('email_exists')
        ) {
          throw new ConflictException(
            'User with this email already exists on the central auth service',
          );
        }
        throw err;
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.userProfile.create({
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            username: dto.username,
            email: dto.email,
            phoneNumber: normalizedPhone,
            password: hashedPassword,
            role: dto.role,
          },
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

        await tx.userSettings.create({
          data: { userId: user.id },
        });

        if (isCentralAuthMode()) {
          await tx.userProfile.update({
            where: { id: user.id },
            data: { betterAuthUserId: centralUserId },
          });
        } else {
          try {
            const baHashedPassword = await hashPassword(dto.password);
            const baUserData: any = {
              id: randomUUID(),
              name: `${dto.firstName} ${dto.lastName}`,
              email: dto.email,
              emailVerified: false,
              role: dto.role,
            };
            const baUser = await baPrisma.betterAuthUser.create({
              data: baUserData,
            });
            await baPrisma.betterAuthAccount.create({
              data: {
                id: randomUUID(),
                userId: baUser.id,
                accountId: dto.email,
                providerId: 'email',
                password: baHashedPassword,
              },
            });
            await tx.userProfile.update({
              where: { id: user.id },
              data: { betterAuthUserId: baUser.id },
            });
          } catch (err) {
            console.warn(`Failed to create BA user for ${dto.email}`, err);
          }
        }

        return user;
      });
    } catch (err) {
      // Saga rollback: the profile tx failed after the central user was
      // created — delete the central user so no orphan remains.
      if (centralUserId) {
        await this.centralAuth
          ?.deleteCentralUser(centralUserId)
          .catch((rollbackErr) =>
            console.warn(
              `Failed to rollback central user ${centralUserId} after user creation failure`,
              rollbackErr,
            ),
          );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateUserDto) {
    const existingUser = await this.prisma.userProfile.findFirst({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    if (dto.email && dto.email !== existingUser.email) {
      const emailTaken = await this.prisma.userProfile.findFirst({
        where: { email: dto.email },
      });
      if (emailTaken) {
        throw new ConflictException('Email already in use');
      }
    }

    if (dto.username && dto.username !== existingUser.username) {
      const usernameTaken = await this.prisma.userProfile.findFirst({
        where: { username: dto.username },
      });
      if (usernameTaken) {
        throw new ConflictException('Username already in use');
      }
    }

    const data: any = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phoneNumber !== undefined) {
      const normalizedPhone = normalizePhone(dto.phoneNumber);
      if (!normalizedPhone)
        throw new BadRequestException('Invalid phone number');
      data.phoneNumber = normalizedPhone;
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 12);
    }

    const updated = await this.prisma.userProfile.update({
      where: { id },
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

    // Sync to BA (legacy) or the central service (central-ba).
    // Warn-and-swallow in both modes (H13): the tenant row is saved.
    if (existingUser.betterAuthUserId) {
      if (isCentralAuthMode()) {
        try {
          const centralData: {
            name?: string;
            email?: string;
            password?: string;
            organizationId?: string;
            orgRole?: string | null;
          } = {};
          if (dto.firstName !== undefined || dto.lastName !== undefined) {
            centralData.name = `${updated.firstName} ${updated.lastName}`;
          }
          if (dto.email !== undefined) centralData.email = dto.email;
          if (dto.password) centralData.password = dto.password;
          if (dto.role !== undefined) {
            // Role → customer removes the org membership (customers are
            // never members, D4); any staff role upserts it.
            centralData.organizationId =
              this.requireCentralAuth().resolveTenantIdForOrg();
            centralData.orgRole = mapUserRoleToOrgRole(dto.role);
          }
          if (Object.keys(centralData).length > 0) {
            await this.requireCentralAuth().updateCentralUser(
              existingUser.betterAuthUserId,
              centralData,
            );
          }
        } catch (err) {
          console.warn(`Failed to sync central user for ${id}`, err);
        }
      } else {
        try {
          const baUserData: any = {};
          if (dto.firstName !== undefined || dto.lastName !== undefined) {
            baUserData.name = `${updated.firstName} ${updated.lastName}`;
          }
          if (dto.email !== undefined) baUserData.email = dto.email;
          if (dto.role !== undefined) baUserData.role = dto.role;
          if (Object.keys(baUserData).length > 0) {
            await baPrisma.betterAuthUser.update({
              where: { id: existingUser.betterAuthUserId },
              data: baUserData,
            });
          }
          if (dto.password) {
            const baHashedPassword = await hashPassword(dto.password);
            await baPrisma.betterAuthAccount.updateMany({
              where: {
                userId: existingUser.betterAuthUserId,
                providerId: 'email',
              },
              data: { password: baHashedPassword },
            });
          }
        } catch (err) {
          console.warn(`Failed to sync BA user for ${id}`, err);
        }
      }
    }

    return updated;
  }

  async remove(id: string) {
    const user = await this.prisma.userProfile.findFirst({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.betterAuthUserId) {
      if (isCentralAuthMode()) {
        try {
          await this.requireCentralAuth().deleteCentralUser(
            user.betterAuthUserId,
          );
        } catch (err) {
          console.warn(
            `Failed to delete central user ${user.betterAuthUserId}`,
            err,
          );
        }
      } else {
        try {
          await baPrisma.betterAuthUser.delete({
            where: { id: user.betterAuthUserId },
          });
        } catch (err) {
          console.warn(`Failed to delete BA user ${user.betterAuthUserId}`, err);
        }
      }
    }

    await this.prisma.userProfile.delete({ where: { id } });
    return { message: 'User deleted successfully' };
  }

  async bulkDelete(ids: string[]) {
    const users = await this.prisma.userProfile.findMany({
      where: { id: { in: ids } },
      select: { id: true, betterAuthUserId: true },
    });

    for (const user of users) {
      if (user.betterAuthUserId) {
        if (isCentralAuthMode()) {
          try {
            await this.requireCentralAuth().deleteCentralUser(
              user.betterAuthUserId,
            );
          } catch (err) {
            console.warn(
              `Failed to delete central user ${user.betterAuthUserId}`,
              err,
            );
          }
        } else {
          try {
            await baPrisma.betterAuthUser.delete({
              where: { id: user.betterAuthUserId },
            });
          } catch (err) {
            console.warn(
              `Failed to delete BA user ${user.betterAuthUserId}`,
              err,
            );
          }
        }
      }
    }

    const result = await this.prisma.userProfile.deleteMany({
      where: { id: { in: ids } },
    });
    return { message: `${result.count} users deleted successfully` };
  }

  async bulkUpdateStatus(ids: string[], status: string) {
    const result = await this.prisma.userProfile.updateMany({
      where: { id: { in: ids } },
      data: { status: status as UserStatus },
    });
    return { message: `${result.count} users updated successfully` };
  }

  async getSettings(userId: string) {
    let settings = await this.prisma.userSettings.findFirst({
      where: { userId },
    });
    if (!settings) {
      settings = await this.prisma.userSettings.create({
        data: { userId },
      });
    }
    return settings;
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }
}
