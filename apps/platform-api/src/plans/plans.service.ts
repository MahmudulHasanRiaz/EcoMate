import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_GRACE_DAYS,
  DEFAULT_TRIAL_DAYS,
  SettingsService,
} from '../settings/settings.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreatePlanVersionDto } from './dto/create-plan-version.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Global trial/grace defaults, with hardcoded fallbacks if unset. */
  private trialDefaults(): { trialDays: number; graceDays: number } {
    try {
      return this.settings.getTrialDefaults();
    } catch {
      return {
        trialDays: DEFAULT_TRIAL_DAYS,
        graceDays: DEFAULT_GRACE_DAYS,
      };
    }
  }

  async list() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        versions: { orderBy: { version: 'desc' } },
      },
    });

    return plans.map((plan) => ({
      ...plan,
      currentVersion: plan.versions[0] ?? null,
    }));
  }

  async detail(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: 'desc' } },
      },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return {
      ...plan,
      currentVersion: plan.versions[0] ?? null,
    };
  }

  async create(dto: CreatePlanDto, actorId?: string) {
    const existing = await this.prisma.plan.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Plan slug already exists');

    const defaults = this.trialDefaults();
    const plan = await this.prisma.plan.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        description: dto.description,
        isPublic: dto.isPublic ?? true,
        isFree: dto.isFree ?? false,
        sortOrder: dto.sortOrder ?? 0,
        badge: dto.badge,
        versions: {
          create: {
            version: 1,
            price: dto.price,
            currency: dto.currency ?? 'BDT',
            interval: dto.interval ?? 'MONTHLY',
            intervalDays: dto.intervalDays,
            trialDays: dto.trialDays ?? defaults.trialDays,
            features: dto.features ?? [],
            limits: (dto.limits ?? {}) as any,
            graceDays: dto.graceDays ?? defaults.graceDays,
          },
        },
      },
      include: { versions: true },
    });

    await this.audit.record({
      actorId,
      action: 'plan.create',
      entity: 'Plan',
      entityId: plan.id,
      after: { slug: plan.slug, name: plan.name, version: 1 },
    });

    return plan;
  }

  async addVersion(
    planId: string,
    dto: CreatePlanVersionDto,
    actorId?: string,
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const latest = await this.prisma.planVersion.findFirst({
      where: { planId },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    const defaults = this.trialDefaults();

    const created = await this.prisma.planVersion.create({
      data: {
        planId,
        version,
        price: dto.price,
        currency: dto.currency ?? latest?.currency ?? 'BDT',
        interval: dto.interval ?? latest?.interval ?? 'MONTHLY',
        intervalDays: dto.intervalDays ?? latest?.intervalDays,
        trialDays: dto.trialDays ?? latest?.trialDays ?? defaults.trialDays,
        features: dto.features ?? latest?.features ?? [],
        limits: (dto.limits ?? (latest?.limits as any) ?? {}) as any,
        graceDays: dto.graceDays ?? latest?.graceDays ?? defaults.graceDays,
      },
    });

    await this.audit.record({
      actorId,
      action: 'plan.version.create',
      entity: 'PlanVersion',
      entityId: created.id,
      after: { planId, version },
    });

    return created;
  }

  async update(planId: string, dto: UpdatePlanDto, actorId?: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;
    if (dto.isFree !== undefined) data.isFree = dto.isFree;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.badge !== undefined) data.badge = dto.badge;

    const updated = await this.prisma.plan.update({
      where: { id: planId },
      data: data as any,
    });

    await this.audit.record({
      actorId,
      action: 'plan.update',
      entity: 'Plan',
      entityId: updated.id,
      before: {
        name: plan.name,
        isActive: plan.isActive,
        isPublic: plan.isPublic,
        isFree: plan.isFree,
        sortOrder: plan.sortOrder,
      },
      after: data,
    });

    return updated;
  }

  async archive(planId: string, actorId?: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const updated = await this.prisma.plan.update({
      where: { id: planId },
      data: { isActive: false, isPublic: false },
    });

    await this.audit.record({
      actorId,
      action: 'plan.archive',
      entity: 'Plan',
      entityId: updated.id,
      before: { isActive: plan.isActive, isPublic: plan.isPublic },
      after: { isActive: false, isPublic: false },
    });

    return updated;
  }
}
