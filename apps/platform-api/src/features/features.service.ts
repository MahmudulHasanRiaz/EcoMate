import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FEATURES } from '@ecomate/shared-types';
import { AuditService } from '../common/audit.service';
import { AddOnsService } from '../pricing/add-ons.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { FEATURE_CONTENT, type FeatureKindLabel } from './feature-content';
import { BulkKindDto } from './dto/bulk-kind.dto';
import { ConvertToAddOnDto } from './dto/convert-to-addon.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';

/** Prisma FeatureKind enum → Boss's words at the API boundary. */
export function toKindLabel(kind: string): FeatureKindLabel {
  return kind === 'ADD_ON' ? 'add-on' : 'initial';
}

/** Boss's words → Prisma FeatureKind enum. */
export function fromKindLabel(kind: FeatureKindLabel): 'INITIAL' | 'ADD_ON' {
  return kind === 'add-on' ? 'ADD_ON' : 'INITIAL';
}

type FeatureRow = {
  key: string;
  name: string;
  description: string | null;
  category: string;
  dependencies: string[];
  unit: string | null;
  isActive: boolean;
  sortOrder: number;
  kind: string;
  scope: string | null;
  withoutAccess: string | null;
  addOnId: string | null;
  addOn?: {
    id: string;
    slug: string;
    name: string;
    price: unknown;
    currency: string;
    isActive: boolean;
  } | null;
};

/**
 * Features page API (Boss point 1). The Feature table was seed-only —
 * nothing read or wrote it. Now the console lists, classifies
 * (initial vs add-on), edits, bulk-marks, and converts features.
 *
 * Dependencies always come from the FEATURES record (the single source
 * of truth — spec §5), never from a second map.
 */
@Injectable()
export class FeaturesService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly addOns: AddOnsService,
  ) {}

  private present(row: FeatureRow) {
    const catalogue = FEATURES[row.key];
    const defaults = FEATURE_CONTENT[row.key];
    return {
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      // Catalogue wins for dependencies; the DB column is a synced copy.
      dependencies: catalogue?.dependencies ?? row.dependencies ?? [],
      unit: row.unit,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      kind: toKindLabel(row.kind),
      // DB text wins; the content defaults cover rows seeded before
      // the backfill ran (or a future catalogue key).
      scope: row.scope ?? defaults?.scope ?? null,
      withoutAccess: row.withoutAccess ?? defaults?.withoutAccess ?? null,
      addOnId: row.addOnId,
      addOn: row.addOn
        ? {
            id: row.addOn.id,
            slug: row.addOn.slug,
            name: row.addOn.name,
            price: Number(row.addOn.price),
            currency: row.addOn.currency,
            isActive: row.addOn.isActive,
          }
        : null,
    };
  }

  async list(query: {
    kind?: FeatureKindLabel;
    category?: string;
    search?: string;
  }) {
    const where: Record<string, unknown> = {};
    if (query.kind) where.kind = fromKindLabel(query.kind);
    if (query.category) where.category = query.category;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.feature.findMany({
      where: where as never,
      include: {
        addOn: {
          select: {
            id: true,
            slug: true,
            name: true,
            price: true,
            currency: true,
            isActive: true,
          },
        },
      },
      // Categories sort alphabetically A–O ('A: Storefront' …).
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.map((row) => this.present(row as FeatureRow));
  }

  async detail(key: string) {
    const row = await this.prisma.feature.findUnique({
      where: { key },
      include: {
        addOn: {
          select: {
            id: true,
            slug: true,
            name: true,
            price: true,
            currency: true,
            isActive: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException(`Feature "${key}" not found`);

    // Plan versions whose features include this key — or the '*'
    // wildcard, which includes every feature (served by the GIN index
    // on PlanVersion.features).
    const versions = await this.prisma.planVersion.findMany({
      where: {
        OR: [{ features: { has: key } }, { features: { has: '*' } }],
      },
      include: {
        plan: {
          select: { id: true, name: true, slug: true, isActive: true },
        },
      },
      orderBy: [{ planId: 'asc' }, { version: 'desc' }],
    });
    const planIds = [...new Set(versions.map((v) => v.planId))];
    const latestByPlan = new Map<string, number>();
    if (planIds.length > 0) {
      const allVersions = await this.prisma.planVersion.findMany({
        where: { planId: { in: planIds } },
        select: { planId: true, version: true },
      });
      for (const v of allVersions) {
        const current = latestByPlan.get(v.planId) ?? 0;
        if (v.version > current) latestByPlan.set(v.planId, v.version);
      }
    }

    return {
      ...this.present(row as FeatureRow),
      plans: versions.map((v) => ({
        planId: v.planId,
        planName: v.plan.name,
        planSlug: v.plan.slug,
        planActive: v.plan.isActive,
        versionId: v.id,
        version: v.version,
        price: Number(v.price),
        currency: v.currency,
        isLatest: latestByPlan.get(v.planId) === v.version,
      })),
    };
  }

  /**
   * Classification + text edit. A kind change is classification ONLY —
   * it moves no tenant and no money (the billing conversion is
   * convertToAddOn). Kind changes are audited; text edits are audited
   * too, under their own action.
   */
  async update(key: string, dto: UpdateFeatureDto, actorId?: string) {
    const before = await this.prisma.feature.findUnique({ where: { key } });
    if (!before) throw new NotFoundException(`Feature "${key}" not found`);
    if (
      dto.kind === undefined &&
      dto.scope === undefined &&
      dto.withoutAccess === undefined
    ) {
      throw new BadRequestException('Nothing to update');
    }

    const data: Record<string, unknown> = {};
    if (dto.kind !== undefined) data.kind = fromKindLabel(dto.kind);
    if (dto.scope !== undefined) data.scope = dto.scope;
    if (dto.withoutAccess !== undefined) {
      data.withoutAccess = dto.withoutAccess;
    }
    const updated = await this.prisma.feature.update({
      where: { key },
      data: data as never,
      include: {
        addOn: {
          select: {
            id: true,
            slug: true,
            name: true,
            price: true,
            currency: true,
            isActive: true,
          },
        },
      },
    });

    const kindChanged =
      dto.kind !== undefined && toKindLabel(before.kind) !== dto.kind;
    await this.audit.record({
      actorId,
      action: kindChanged ? 'feature.kind.change' : 'feature.update',
      entity: 'Feature',
      entityId: key,
      before: {
        kind: toKindLabel(before.kind),
        scope: before.scope,
        withoutAccess: before.withoutAccess,
      },
      after: data,
    });
    return this.present(updated as FeatureRow);
  }

  /** Bulk classification (Boss §0 decision 1: individual + bulk marking). */
  async bulkKind(dto: BulkKindDto, actorId?: string) {
    const keys = [...new Set(dto.keys)];
    const rows = await this.prisma.feature.findMany({
      where: { key: { in: keys } },
      select: { key: true, kind: true },
    });
    const found = new Set(rows.map((row) => row.key));
    const missing = keys.filter((key) => !found.has(key));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown feature key(s): ${missing.join(', ')}`,
      );
    }
    const target = fromKindLabel(dto.kind);
    const changed = rows.filter((row) => row.kind !== target);
    if (changed.length > 0) {
      await this.prisma.feature.updateMany({
        where: { key: { in: changed.map((row) => row.key) } },
        data: { kind: target },
      });
      for (const row of changed) {
        await this.audit.record({
          actorId,
          action: 'feature.kind.change',
          entity: 'Feature',
          entityId: row.key,
          before: { kind: toKindLabel(row.kind) },
          after: { kind: dto.kind, bulk: true },
        });
      }
    }
    return {
      kind: dto.kind,
      requested: keys.length,
      updated: changed.length,
      keys: changed.map((row) => row.key),
    };
  }

  /**
   * Convert a plan feature into a paid add-on (pricing design §10.3):
   * dry-run lists the plans + affected tenants; execute creates the
   * add-on, grandfather-attaches it (no first-period invoice), and
   * re-versions the plans without the key via the apply-version flow.
   * The heavy lifting lives in AddOnsService.convertFromFeature; this
   * endpoint adds the feature-side guard (already converted → 409).
   */
  async convertToAddOn(
    key: string,
    dto: ConvertToAddOnDto,
    actorId?: string,
  ) {
    const feature = await this.prisma.feature.findUnique({
      where: { key },
      select: { key: true, addOnId: true },
    });
    if (!feature) throw new NotFoundException(`Feature "${key}" not found`);
    if (feature.addOnId) {
      throw new ConflictException(
        `Feature "${key}" is already sold as an add-on`,
      );
    }
    return this.addOns.convertFromFeature(
      { ...dto, featureKey: key },
      actorId,
    );
  }
}
