import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { TenantRefreshService } from '../common/tenant-refresh.service';
import { wholeDaysBetween } from '../billing/billing-dates';
import { InvoiceService } from '../billing/invoice.service';
import { assertKnownFeatureKeys } from '../features/feature-keys';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { parsePricingDocument } from './pricing-document';
import { round2 } from './pricing-engine';
import {
  AttachAddOnDto,
  ConvertFeatureDto,
  CreateAddOnDto,
  DetachAddOnDto,
  UpdateAddOnDto,
} from './dto/add-on.dto';

/**
 * Add-ons (design §10). AddOn + SubscriptionAddOn existed but had no
 * billing or lifecycle: nothing invoiced an add-on and nothing
 * attached/detached one outside raw DB access. New: admin CRUD,
 * attach/detach with proration, renewal inclusion, public visibility,
 * and the feature→add-on conversion flow (§10.3).
 *
 * Add-on prices live on the AddOn row (no versioning in v1 — a price
 * change applies to all attached tenants at their next renewal; the
 * console warns the operator and shows the affected count first).
 */
@Injectable()
export class AddOnsService {
  private readonly logger = new Logger(AddOnsService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoiceService,
    private readonly refresh: TenantRefreshService,
    private readonly plans: PlansService,
  ) {}

  // ── Admin CRUD ───────────────────────────────────────────────────────

  async list(includeInactive = false) {
    const addOns = await this.prisma.addOn.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    });
    return addOns.map((addOn) => ({
      ...addOn,
      price: Number(addOn.price),
      attachedCount: addOn._count.subscriptions,
    }));
  }

  async create(dto: CreateAddOnDto, actorId?: string) {
    const existing = await this.prisma.addOn.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Add-on slug already exists');

    // Gap 11 (same as plans): add-on features must be catalogue keys
    // (or the '*' wildcard), never arbitrary strings.
    assertKnownFeatureKeys(dto.features);

    const metering = dto.metering
      ? parsePricingDocument({ metering: dto.metering }).metering
      : undefined;
    const addOn = await this.prisma.addOn.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        currency: dto.currency ?? 'BDT',
        interval: dto.interval ?? 'MONTHLY',
        features: dto.features ?? [],
        limits: (dto.limits ?? {}) as any,
        isPublic: dto.isPublic ?? true,
        sortOrder: dto.sortOrder ?? 0,
        metering: metering as any,
      },
    });
    await this.audit.record({
      actorId,
      action: 'addon.create',
      entity: 'AddOn',
      entityId: addOn.id,
      after: { slug: addOn.slug, name: addOn.name, price: dto.price },
    });
    return { ...addOn, price: Number(addOn.price) };
  }

  async update(id: string, dto: UpdateAddOnDto, actorId?: string) {
    const before = await this.prisma.addOn.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Add-on not found');
    assertKnownFeatureKeys(dto.features);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.interval !== undefined) data.interval = dto.interval;
    if (dto.features !== undefined) data.features = dto.features;
    if (dto.limits !== undefined) data.limits = dto.limits;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.metering !== undefined) {
      data.metering = dto.metering
        ? parsePricingDocument({ metering: dto.metering }).metering
        : null;
    }
    const updated = await this.prisma.addOn.update({
      where: { id },
      data: data as any,
    });
    await this.audit.record({
      actorId,
      action: 'addon.update',
      entity: 'AddOn',
      entityId: id,
      before: { price: String(before.price), isActive: before.isActive },
      after: data,
    });
    return { ...updated, price: Number(updated.price) };
  }

  async archive(id: string, actorId?: string) {
    const before = await this.prisma.addOn.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Add-on not found');
    const updated = await this.prisma.addOn.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.record({
      actorId,
      action: 'addon.archive',
      entity: 'AddOn',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive: false },
    });
    return updated;
  }

  /** Tenants currently attached — shown before a price change (§10.2). */
  async attachedTenants(id: string) {
    const addOn = await this.prisma.addOn.findUnique({ where: { id } });
    if (!addOn) throw new NotFoundException('Add-on not found');
    const now = new Date();
    const rows = await this.prisma.subscriptionAddOn.findMany({
      where: {
        addOnId: id,
        startedAt: { lte: now },
        OR: [{ endedAt: null }, { endedAt: { gt: now } }],
      },
      include: {
        subscription: {
          select: {
            tenant: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    return {
      addOnId: id,
      count: rows.length,
      tenants: rows.map((row) => row.subscription.tenant),
    };
  }

  // ── Attach / detach ──────────────────────────────────────────────────

  async listAttached(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      select: { id: true },
    });
    if (!subscription) return [];
    const rows = await this.prisma.subscriptionAddOn.findMany({
      where: { subscriptionId: subscription.id },
      orderBy: { startedAt: 'desc' },
      include: { addOn: true },
    });
    const now = new Date();
    return rows.map((row) => ({
      ...row,
      addOn: { ...row.addOn, price: Number(row.addOn.price) },
      active:
        row.startedAt <= now && (row.endedAt === null || row.endedAt > now),
    }));
  }

  /**
   * Attach with effectiveAt immediate | next_period (same semantics as
   * plan change). Immediate attaches + prorates the add-on fee into a
   * one-line invoice for the rest of the period. Next-period attach
   * records the row with startedAt = next period start; the renewal job
   * picks up rows whose startedAt has been reached.
   *
   * The proration invoice is kind MANUAL with NO subscriptionId: paying
   * it must not extend the subscription (a prorated add-on fee is not a
   * renewal), and approveProof extends any paid invoice that carries a
   * subscriptionId.
   */
  async attach(
    tenantId: string,
    addOnId: string,
    dto: AttachAddOnDto,
    actorId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const addOn = await this.prisma.addOn.findUnique({
      where: { id: addOnId },
    });
    if (!addOn) throw new NotFoundException('Add-on not found');
    if (!addOn.isActive) {
      throw new BadRequestException('This add-on is archived');
    }
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });
    if (!subscription) {
      throw new BadRequestException('This tenant has no subscription');
    }
    const existing = await this.prisma.subscriptionAddOn.findUnique({
      where: {
        subscriptionId_addOnId: {
          subscriptionId: subscription.id,
          addOnId,
        },
      },
    });
    const now = new Date();
    const isActive =
      existing &&
      existing.startedAt <= now &&
      (existing.endedAt === null || existing.endedAt > now);
    if (isActive) {
      throw new ConflictException('This add-on is already attached');
    }

    const effectiveAt = dto.effectiveAt ?? 'immediate';
    let invoice: { id: string; number: string } | null = null;

    if (effectiveAt === 'next_period') {
      const startedAt = subscription.currentPeriodEnd;
      const row = existing
        ? await this.prisma.subscriptionAddOn.update({
            where: { id: existing.id },
            data: { startedAt, endedAt: null },
          })
        : await this.prisma.subscriptionAddOn.create({
            data: {
              subscriptionId: subscription.id,
              addOnId,
              startedAt,
            },
          });
      await this.audit.record({
        actorId,
        tenantId,
        action: 'tenant.addon.attach.scheduled',
        entity: 'SubscriptionAddOn',
        entityId: row.id,
        after: { addOnId, effectiveAt: startedAt.toISOString() },
      });
      return { ...row, invoice: null };
    }

    // Immediate: attach now + prorate the add-on fee for the rest of the
    // period (same proration helper as plan change).
    const price = Number(addOn.price);
    if (
      price > 0 &&
      subscription.status !== 'TRIAL' &&
      subscription.currentPeriodEnd > now
    ) {
      const totalDays = Math.max(
        1,
        wholeDaysBetween(
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
        ),
      );
      const remainingDays = wholeDaysBetween(now, subscription.currentPeriodEnd);
      const prorated = round2(price * (remainingDays / totalDays));
      if (prorated > 0) {
        invoice = await this.invoices.createInvoice(
          {
            tenantId,
            lines: [
              {
                description: `${addOn.name} add-on — prorated (${remainingDays} of ${totalDays} days remaining)`,
                quantity: 1,
                unitPrice: prorated,
              },
            ],
            kind: 'MANUAL',
            metadata: { addOnId, attachProration: true },
            notes: `Add-on ${addOn.name} attached mid-period`,
          },
          actorId,
        );
      }
    }

    const row = existing
      ? await this.prisma.subscriptionAddOn.update({
          where: { id: existing.id },
          data: { startedAt: now, endedAt: null },
        })
      : await this.prisma.subscriptionAddOn.create({
          data: { subscriptionId: subscription.id, addOnId, startedAt: now },
        });

    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.addon.attach',
      entity: 'SubscriptionAddOn',
      entityId: row.id,
      after: { addOnId, invoiceId: invoice?.id ?? null },
    });
    const pushed = await this.refresh.pushRefresh(tenant.slug);
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed for ${tenant.slug}: ${pushed.error}`,
      );
    }
    return { ...row, invoice };
  }

  /**
   * Detach: immediate ends billing at once (no refund of the current
   * period — stated in the console confirm); next-period sets endedAt =
   * period end and the renewal job skips it.
   */
  async detach(
    tenantId: string,
    addOnId: string,
    dto: DetachAddOnDto,
    actorId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      select: { id: true, currentPeriodEnd: true },
    });
    if (!subscription) {
      throw new BadRequestException('This tenant has no subscription');
    }
    const existing = await this.prisma.subscriptionAddOn.findUnique({
      where: {
        subscriptionId_addOnId: {
          subscriptionId: subscription.id,
          addOnId,
        },
      },
    });
    const now = new Date();
    const isActive =
      existing &&
      existing.startedAt <= now &&
      (existing.endedAt === null || existing.endedAt > now);
    if (!isActive || !existing) {
      throw new NotFoundException('This add-on is not attached');
    }

    const effectiveAt = dto.effectiveAt ?? 'immediate';
    const endedAt =
      effectiveAt === 'next_period' ? subscription.currentPeriodEnd : now;
    const row = await this.prisma.subscriptionAddOn.update({
      where: { id: existing.id },
      data: { endedAt },
    });
    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.addon.detach',
      entity: 'SubscriptionAddOn',
      entityId: row.id,
      after: { addOnId, endedAt: endedAt.toISOString(), effectiveAt },
    });
    const pushed = await this.refresh.pushRefresh(tenant.slug);
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed for ${tenant.slug}: ${pushed.error}`,
      );
    }
    return row;
  }

  // ── Feature → add-on conversion (§10.3) ──────────────────────────────
  //
  // The CONVERSION FLOW (dry-run + apply) is built here. The conversion
  // BATCH — which features convert, at what prices — is Boss's call
  // (design §14 open question 1) and is not run here.

  /**
   * Convert an existing plan feature into a paid add-on.
   *
   * 1. Dry-run: list plans whose latest version includes the key +
   *    tenants on those plans.
   * 2. Apply: create the AddOn; attach it to every subscription on those
   *    plans (grandfathered — no invoice for the first period; billing
   *    starts at the next renewal); remove the key from the plans'
   *    features (new version per plan, applied to existing subscriptions
   *    via the existing apply-version flow — the tenant keeps the feature
   *    via the add-on, so nothing breaks).
   *
   * Attach-first ordering: the registry unions plan features + add-on
   * features, so attaching before the plan versions change means the
   * feature never drops from any tenant.
   */
  async convertFromFeature(dto: ConvertFeatureDto, actorId?: string) {
    const feature = await this.prisma.feature.findUnique({
      where: { key: dto.featureKey },
    });
    if (!feature) {
      throw new NotFoundException(`Feature "${dto.featureKey}" not found`);
    }
    const slug = dto.featureKey.replace(/_/g, '-');

    // Plans whose LATEST version includes the feature.
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    const affectedPlans = plans.filter((plan) =>
      (plan.versions[0]?.features ?? []).includes(dto.featureKey),
    );

    const tenantRows = await this.prisma.subscription.findMany({
      where: {
        planVersion: {
          planId: { in: affectedPlans.map((plan) => plan.id) },
        },
        status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] },
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        planVersion: { select: { id: true, planId: true } },
      },
    });
    const tenants = tenantRows.map((row) => ({
      tenantId: row.tenantId,
      tenantName: row.tenant.name,
      tenantSlug: row.tenant.slug,
      planId: row.planVersion.planId,
      subscriptionId: row.id,
    }));

    if (dto.dryRun !== false) {
      return {
        dryRun: true,
        featureKey: dto.featureKey,
        slug,
        price: dto.price,
        affectedPlans: affectedPlans.map((plan) => ({
          planId: plan.id,
          planName: plan.name,
          latestVersionId: plan.versions[0]?.id ?? null,
        })),
        affectedTenants: tenants.length,
        tenants,
      };
    }

    // Pre-validate the re-versioned plan features BEFORE creating the
    // add-on: addVersion rejects unknown (legacy) keys, and a 400
    // mid-convert would strand an orphan add-on + grandfathered
    // attachments — and a retry would then 409 on the slug. Fail fast
    // with no side effects instead.
    for (const plan of affectedPlans) {
      const latest = plan.versions[0];
      if (!latest) continue;
      assertKnownFeatureKeys(
        (latest.features ?? []).filter((key) => key !== dto.featureKey),
      );
    }

    const existingAddOn = await this.prisma.addOn.findUnique({
      where: { slug },
    });
    if (existingAddOn) {
      throw new ConflictException(
        `An add-on with slug "${slug}" already exists`,
      );
    }

    const addOn = await this.prisma.addOn.create({
      data: {
        slug,
        name: dto.name ?? feature.name,
        description:
          dto.description ?? `Converted from the ${feature.name} plan feature`,
        price: dto.price,
        currency: 'BDT',
        interval: 'MONTHLY',
        features: [dto.featureKey],
        limits: {},
        isPublic: true,
        sortOrder: 0,
      },
    });

    // Attach first (grandfathered: no invoice for the first period).
    let attached = 0;
    const now = new Date();
    for (const row of tenantRows) {
      await this.prisma.subscriptionAddOn.upsert({
        where: {
          subscriptionId_addOnId: {
            subscriptionId: row.id,
            addOnId: addOn.id,
          },
        },
        create: {
          subscriptionId: row.id,
          addOnId: addOn.id,
          startedAt: now,
        },
        update: { startedAt: now, endedAt: null },
      });
      attached += 1;
    }

    // Then remove the key from each affected plan (new version, applied).
    const versionsCreated: Array<{
      planId: string;
      versionId: string;
      version: number;
    }> = [];
    for (const plan of affectedPlans) {
      const latest = plan.versions[0];
      if (!latest) continue;
      const features = (latest.features ?? []).filter(
        (key) => key !== dto.featureKey,
      );
      const created = await this.plans.addVersion(
        plan.id,
        {
          price: Number(latest.price),
          currency: latest.currency,
          interval: latest.interval,
          intervalDays: latest.intervalDays ?? undefined,
          trialDays: latest.trialDays,
          features,
          limits: (latest.limits ?? {}) as Record<string, number>,
          graceDays: latest.graceDays,
        },
        actorId,
      );
      await this.plans.applyVersion(
        plan.id,
        created.id,
        { dryRun: false },
        actorId,
      );
      versionsCreated.push({
        planId: plan.id,
        versionId: created.id,
        version: created.version,
      });
    }

    await this.audit.record({
      actorId,
      action: 'addon.convert-from-feature',
      entity: 'AddOn',
      entityId: addOn.id,
      after: {
        featureKey: dto.featureKey,
        price: dto.price,
        attached,
        plans: versionsCreated.length,
      },
    });
    // The Features page reads kind/addOnId from the Feature row: the
    // conversion is not complete until the row says so. (The row was
    // verified to exist at the top of this method.)
    await this.prisma.feature.update({
      where: { key: dto.featureKey },
      data: { kind: 'ADD_ON', addOnId: addOn.id },
    });
    const pushed = await this.refresh.pushRefresh('*');
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed after feature conversion: ${pushed.error}`,
      );
    }
    return {
      dryRun: false,
      featureKey: dto.featureKey,
      addOnId: addOn.id,
      slug,
      price: dto.price,
      attached,
      plans: versionsCreated,
      tenants,
    };
  }
}
