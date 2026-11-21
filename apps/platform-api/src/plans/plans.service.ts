import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { TenantRefreshService } from '../common/tenant-refresh.service';
import { assertKnownFeatureKeys } from '../features/feature-keys';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  BillingCycle,
  PricingDocument,
  billingCycleToInterval,
  buildPricingDocument,
  intervalToBillingCycle,
  parsePricingDocument,
  validatePricingDocument,
} from '../pricing/pricing-document';
import {
  DEFAULT_GRACE_DAYS,
  DEFAULT_TRIAL_DAYS,
  SettingsService,
} from '../settings/settings.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreatePlanVersionDto } from './dto/create-plan-version.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import {
  normalizePlanPrices,
  normalizeVersionPrice,
} from './plan-price';

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly refresh: TenantRefreshService,
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

  /**
   * Resolve the pricing document + price + interval for a plan create /
   * add-version write (design §3).
   *
   * - The document is strictly validated (unknown keys rejected).
   * - When supplied, `price` is derived from pricing.baseFee.amount and
   *   the interval from pricing.billingCycle. An explicitly supplied
   *   interval that disagrees with the cycle is a 400 (ambiguous write).
   * - When omitted on add-version, the previous version's pricing is
   *   inherited (mirroring price/interval inheritance) with baseFee
   *   re-pointed at the new price, so price and
   *   pricing.baseFee.amount can never drift.
   * - When omitted on create, the document is built from price/interval
   *   (a fixed-price plan).
   */
  private resolvePricingForWrite(input: {
    dtoPricing?: PricingDocument | null;
    dtoPrice: number;
    dtoCurrency?: string;
    dtoInterval?: 'MONTHLY' | 'YEARLY' | 'CUSTOM';
    dtoIntervalDays?: number;
    previous?: {
      price: unknown;
      currency: string;
      interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM';
      intervalDays: number | null;
      pricing: unknown;
    } | null;
  }): {
    pricing: PricingDocument;
    price: number;
    currency: string;
    interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM';
    intervalDays: number | null | undefined;
  } {
    const currency =
      input.dtoCurrency ?? input.previous?.currency ?? 'BDT';
    const fallbackInterval =
      input.dtoInterval ?? input.previous?.interval ?? 'MONTHLY';
    const fallbackIntervalDays =
      input.dtoIntervalDays ?? input.previous?.intervalDays ?? undefined;

    if (input.dtoPricing) {
      const errors = validatePricingDocument(input.dtoPricing);
      if (errors.length > 0) {
        throw new BadRequestException(
          `Invalid pricing document: ${errors.join('; ')}`,
        );
      }
      const doc = input.dtoPricing as PricingDocument;
      const cycle = doc.billingCycle as BillingCycle | undefined;
      let interval = fallbackInterval;
      let intervalDays: number | null | undefined = fallbackIntervalDays;
      if (cycle) {
        const mapped = billingCycleToInterval(cycle);
        if (
          input.dtoInterval !== undefined &&
          (input.dtoInterval !== mapped.interval ||
            (mapped.interval === 'CUSTOM' &&
              input.dtoIntervalDays !== undefined &&
              input.dtoIntervalDays !== mapped.intervalDays))
        ) {
          throw new BadRequestException(
            `pricing.billingCycle ${cycle} conflicts with the supplied interval`,
          );
        }
        interval = mapped.interval;
        intervalDays = mapped.intervalDays;
      }
      const price = doc.baseFee?.amount ?? input.dtoPrice;
      const pricing = buildPricingDocument(doc, {
        price,
        currency,
        interval,
        intervalDays,
      });
      return { pricing, price, currency, interval, intervalDays };
    }

    if (input.previous) {
      const inherited = parsePricingDocument(input.previous.pricing);
      // Re-point the inherited base fee at the new price (the new
      // version's price is dto.price; the other components carry over).
      inherited.baseFee = {
        amount: input.dtoPrice,
        currency,
      };
      if (!inherited.billingCycle) {
        inherited.billingCycle = intervalToBillingCycle(
          fallbackInterval,
          fallbackIntervalDays,
        );
      }
      return {
        pricing: inherited,
        price: input.dtoPrice,
        currency,
        interval: fallbackInterval,
        intervalDays: fallbackIntervalDays,
      };
    }

    const pricing = buildPricingDocument(undefined, {
      price: input.dtoPrice,
      currency,
      interval: fallbackInterval,
      intervalDays: fallbackIntervalDays,
    });
    return {
      pricing,
      price: input.dtoPrice,
      currency,
      interval: fallbackInterval,
      intervalDays: fallbackIntervalDays,
    };
  }

  async list() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        versions: { orderBy: { version: 'desc' } },
      },
    });

    return plans.map((plan) => {
      const normalized = normalizePlanPrices(plan);
      return {
        ...normalized,
        currentVersion: normalized.versions[0] ?? null,
      };
    });
  }

  async detail(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: 'desc' } },
      },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const normalized = normalizePlanPrices(plan);
    return {
      ...normalized,
      currentVersion: normalized.versions[0] ?? null,
    };
  }

  async create(dto: CreatePlanDto, actorId?: string) {
    const existing = await this.prisma.plan.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Plan slug already exists');

    // Gap 11: plan features must be catalogue keys (or the '*' wildcard),
    // never arbitrary strings.
    assertKnownFeatureKeys(dto.features);

    const defaults = this.trialDefaults();
    const resolved = this.resolvePricingForWrite({
      dtoPricing: dto.pricing as PricingDocument | undefined,
      dtoPrice: dto.price,
      dtoCurrency: dto.currency,
      dtoInterval: dto.interval,
      dtoIntervalDays: dto.intervalDays,
    });
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
            price: resolved.price,
            currency: resolved.currency,
            interval: resolved.interval,
            intervalDays: resolved.intervalDays,
            pricing: resolved.pricing as any,
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

    return normalizePlanPrices(plan);
  }

  async addVersion(
    planId: string,
    dto: CreatePlanVersionDto,
    actorId?: string,
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    // Gap 11: same catalogue validation as create.
    assertKnownFeatureKeys(dto.features);

    const latest = await this.prisma.planVersion.findFirst({
      where: { planId },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    const defaults = this.trialDefaults();
    const resolved = this.resolvePricingForWrite({
      dtoPricing: dto.pricing as PricingDocument | undefined,
      dtoPrice: dto.price,
      dtoCurrency: dto.currency,
      dtoInterval: dto.interval,
      dtoIntervalDays: dto.intervalDays,
      previous: latest
        ? {
            price: latest.price,
            currency: latest.currency,
            interval: latest.interval,
            intervalDays: latest.intervalDays,
            pricing: (latest as { pricing?: unknown }).pricing,
          }
        : null,
    });

    const created = await this.prisma.planVersion.create({
      data: {
        planId,
        version,
        price: resolved.price,
        currency: resolved.currency,
        interval: resolved.interval,
        intervalDays: resolved.intervalDays,
        pricing: resolved.pricing as any,
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

    return normalizeVersionPrice(created);
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

  /**
   * Make a plan version the signup default (Phase 8, D3): new signups
   * provision onto this version instead of the newest one. Exactly one
   * version is the default at a time — the flip runs in one transaction
   * (advisory lock + clear-all + set) so concurrent flips queue instead of
   * racing the partial unique index. Audited.
   */
  async setDefaultVersion(
    planId: string,
    versionId: string,
    actorId?: string,
  ) {
    const version = await this.prisma.planVersion.findUnique({
      where: { id: versionId },
      include: {
        plan: { select: { id: true, name: true, isActive: true } },
      },
    });
    if (!version || version.planId !== planId) {
      throw new NotFoundException('Plan version not found');
    }
    if (version.archivedAt) {
      throw new BadRequestException('This plan version is archived');
    }
    if (!version.plan.isActive) {
      throw new BadRequestException(
        'This plan is inactive; its versions cannot be the signup default',
      );
    }

    const previous = await this.prisma.planVersion.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    // Flip inside one transaction, serialized by an advisory lock. A single
    // UPDATE setting every row at once is NOT safe: Postgres checks the
    // partial unique index per row as it updates, so flipping to the
    // physically-first row sets it true while the old default is still true
    // (23505 — found live 2026-11-17). Clear-then-set inside one statement
    // each is safe (the index is checked per statement), and the lock makes
    // concurrent flips queue instead of racing.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ecomate:plan-version-default'))`;
        await tx.$executeRaw`UPDATE "PlanVersion" SET "isDefault" = false WHERE "isDefault" = true`;
        await tx.planVersion.update({
          where: { id: versionId },
          data: { isDefault: true },
        });
      });
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('PlanVersion_single_default_idx')
      ) {
        throw new ConflictException(
          'The signup default changed concurrently; please retry',
        );
      }
      throw err;
    }

    await this.audit.record({
      actorId,
      action: 'plan.version.setDefault',
      entity: 'PlanVersion',
      entityId: versionId,
      before: { previousDefaultId: previous?.id ?? null },
      after: { planId, version: version.version, isDefault: true },
    });

    return {
      id: version.id,
      planId,
      version: version.version,
      isDefault: true,
    };
  }

  /**
   * Apply a plan version to the existing subscriptions on OTHER versions of
   * the SAME plan — an explicit operator action, never silent. A new plan
   * version never moves existing subscribers by itself (see 6.10 finding
   * F1: only new signups follow the newest version). Dry-run returns the
   * affected tenants without changing anything.
   */
  async applyVersion(
    planId: string,
    versionId: string,
    options: { dryRun?: boolean },
    actorId?: string,
  ) {
    const version = await this.prisma.planVersion.findUnique({
      where: { id: versionId },
      include: { plan: { select: { id: true, name: true } } },
    });
    if (!version || version.planId !== planId) {
      throw new NotFoundException('Plan version not found');
    }
    if (version.archivedAt) {
      throw new BadRequestException('This plan version is archived');
    }

    const affected = await this.prisma.subscription.findMany({
      where: {
        planVersion: { planId },
        planVersionId: { not: versionId },
        status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] },
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });
    const tenants = affected.map((subscription) => ({
      tenantId: subscription.tenantId,
      tenantName: subscription.tenant.name,
      tenantSlug: subscription.tenant.slug,
      fromVersionId: subscription.planVersionId,
      status: subscription.status,
    }));

    if (options.dryRun) {
      return {
        planId,
        versionId,
        version: version.version,
        dryRun: true,
        affected: tenants.length,
        tenants,
      };
    }

    const now = new Date();
    const snapshot = {
      features: version.features,
      limits: version.limits,
      changedAt: now.toISOString(),
    } as any;
    for (const subscription of affected) {
      await this.prisma.$transaction([
        this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { planVersionId: versionId, entitlementsSnapshot: snapshot },
        }),
        this.prisma.tenant.update({
          where: { id: subscription.tenantId },
          data: { planVersionId: versionId },
        }),
      ]);
      await this.audit.record({
        actorId,
        tenantId: subscription.tenantId,
        action: 'tenant.plan.version.apply',
        entity: 'Tenant',
        entityId: subscription.tenantId,
        before: { planVersionId: subscription.planVersionId },
        after: { planVersionId: versionId, planId },
      });
    }
    if (affected.length > 0) {
      const pushed = await this.refresh.pushRefresh('*');
      if (!pushed.ok) {
        this.logger.warn(
          `Entitlement refresh push failed after plan version apply: ${pushed.error}`,
        );
      }
    }
    return {
      planId,
      versionId,
      version: version.version,
      dryRun: false,
      affected: tenants.length,
      tenants,
    };
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
