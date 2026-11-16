import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import {
  DomainConfigService,
  RESERVED_SLUGS,
} from '../config/domain-config.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_TRIAL_DAYS,
  SettingsService,
} from '../settings/settings.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly domainConfig: DomainConfigService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: {
    page?: string;
    limit?: string;
    status?: string;
    search?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const search = query.search?.trim();

    const where: any = {};
    if (query.status) where.status = query.status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { ownerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          domains: true,
          planVersion: true,
          subscription: { include: { planVersion: true } },
        },
      }),
      this.prisma.tenant.count({ where }),
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
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        domains: true,
        planVersion: true,
        subscription: { include: { planVersion: true } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { invoices: true, payments: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async create(dto: CreateTenantDto, actorId?: string) {
    const slug = dto.slug.trim().toLowerCase();
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException('This slug is reserved');
    }

    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('Tenant slug already exists');

    const planVersion = dto.planVersionId
      ? await this.prisma.planVersion.findUnique({
          where: { id: dto.planVersionId },
        })
      : null;
    if (dto.planVersionId && !planVersion) {
      throw new NotFoundException('Plan version not found');
    }

    const primaryDomain = this.domainConfig.getConfig().primaryDomain;
    const now = new Date();
    let defaultTrialDays = DEFAULT_TRIAL_DAYS;
    try {
      defaultTrialDays = this.settings.getTrialDefaults().trialDays;
    } catch {
      // Settings unavailable: fall back to the hardcoded default.
    }
    const trialDays = dto.trialDays ?? planVersion?.trialDays ?? defaultTrialDays;
    const trialEndsAt = new Date(now.getTime() + trialDays * 86_400_000);
    const status = planVersion ? 'TRIAL' : 'PENDING_VERIFICATION';

    const tenant = await this.prisma.tenant.create({
      data: {
        slug,
        name: dto.name,
        ownerEmail: dto.ownerEmail.trim().toLowerCase(),
        ownerPhone: dto.ownerPhone,
        status: status as any,
        planVersionId: planVersion?.id,
        trialEndsAt,
        currentPeriodStart: planVersion ? now : null,
        currentPeriodEnd: planVersion ? trialEndsAt : null,
        domains: {
          create: {
            host: `${slug}.${primaryDomain}`,
            type: 'SUBDOMAIN',
            baseDomain: primaryDomain,
            isPrimary: true,
            status: 'PENDING',
          },
        },
        ...(planVersion
          ? {
              subscription: {
                create: {
                  planVersionId: planVersion.id,
                  status: 'TRIAL',
                  currentPeriodStart: now,
                  currentPeriodEnd: trialEndsAt,
                  trialEndsAt,
                  entitlementsSnapshot: {
                    features: planVersion.features,
                    limits: planVersion.limits,
                    trialEndsAt,
                  } as any,
                },
              },
            }
          : {}),
      },
      include: {
        domains: true,
        planVersion: true,
        subscription: true,
      },
    });

    await this.audit.record({
      actorId,
      tenantId: tenant.id,
      action: 'tenant.create',
      entity: 'Tenant',
      entityId: tenant.id,
      after: { slug, name: tenant.name, status: tenant.status },
    });

    return tenant;
  }

  async updateStatus(
    id: string,
    dto: UpdateTenantStatusDto,
    actorId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const data: any = { status: dto.status as any };
    if (dto.status === 'SUSPENDED') data.suspendedAt = new Date();
    if (dto.status === 'ACTIVE') data.suspendedAt = null;
    if (dto.status === 'DELETED') data.deletedAt = new Date();

    const updated = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.status.update',
      entity: 'Tenant',
      entityId: id,
      before: { status: tenant.status },
      after: { status: updated.status, reason: dto.reason },
    });

    return updated;
  }

  async extendTrial(id: string, days: number, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const now = new Date();
    const base =
      tenant.trialEndsAt && tenant.trialEndsAt > now
        ? tenant.trialEndsAt
        : now;
    const trialEndsAt = new Date(base.getTime() + days * 86_400_000);

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { trialEndsAt },
    });

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: id },
    });
    if (subscription) {
      await this.prisma.subscription.updateMany({
        where: { tenantId: id },
        data: { trialEndsAt, currentPeriodEnd: trialEndsAt },
      });
    }

    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.trial.extend',
      entity: 'Tenant',
      entityId: id,
      before: { trialEndsAt: tenant.trialEndsAt },
      after: { trialEndsAt, days },
    });

    return updated;
  }

  async changePlan(id: string, dto: ChangePlanDto, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const planVersion = await this.prisma.planVersion.findUnique({
      where: { id: dto.planVersionId },
    });
    if (!planVersion) throw new NotFoundException('Plan version not found');

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { planVersionId: planVersion.id },
    });

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: id },
    });
    if (subscription) {
      await this.prisma.subscription.updateMany({
        where: { tenantId: id },
        data: {
          planVersionId: planVersion.id,
          entitlementsSnapshot: {
            features: planVersion.features,
            limits: planVersion.limits,
            changedAt: new Date().toISOString(),
          } as any,
        },
      });
    }

    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.plan.change',
      entity: 'Tenant',
      entityId: id,
      before: { planVersionId: tenant.planVersionId },
      after: { planVersionId: planVersion.id },
    });

    return updated;
  }
}
