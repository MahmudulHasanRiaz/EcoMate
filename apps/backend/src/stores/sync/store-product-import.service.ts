/**
 * WooCommerce product import — inbound direction (§7, §13, §15–§18).
 *
 * The import service owns the review catalog, the confirm fan-out, and the
 * per-item import itself (`importOne`). The page processor is a thin loop
 * over `importOne`; this service holds every decision.
 *
 * Hard rules (spec §1, Boss's words):
 * - R2: Woo NEVER changes an existing EcoMate product. No re-import field
 *   refresh, no `evaluate()` from the import path, no per-field copy on
 *   link. Re-import of a linked product finds the mapping and skips.
 * - R4: stock is a one-time MANAGED-STOCK seed only (`managedStockQuantity`).
 *   NEVER `setPhysicalStockLevel`, NEVER a physical-inventory write. LINK
 *   and re-import never touch stock.
 * - R5: images download in background jobs; the import run NEVER waits.
 *   10 images per product, download never hotlink, no StoreMediaMapping.
 * - R9: link SKU anchors on the LOCAL product's SKU (+ remote SKU alias if
 *   different), each guarded by the no-steal rule.
 * - §15.4: draft ⇒ NO assignment ever; LINK never overwrites an assignment.
 *
 * Per-item isolation (§13.3): one item's failure never aborts the page.
 * Each item runs in its own transaction; the processor catches unexpected
 * throws and records FAILED:UNEXPECTED.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProviderError, ProviderErrorCategory } from '../../marketing/ad-provider.adapter';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantLimitsService } from '../../entitlements/tenant-limits.service';
import { computeEffectivePrice } from '../../products/product-pricing';
import type {
  CommerceProvider,
  FieldKey,
  FieldSnapshot,
  NormalizedProduct,
  NormalizedVariant,
  StoreWithSecrets,
} from '../providers/provider.contract';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { hashFieldValue } from '../providers/field-snapshot';
import { FieldOwnershipService } from '../distribution/field-ownership.service';
import { StoresService } from '../stores.service';
import { productImportEnabled } from '../store-flags';
import { SyncQueuesService } from './sync-queues.service';
import { SyncRunService } from './sync-run.service';
import { StockStatusSyncService } from './stock-status-sync.service';
import { readEcoMateFields } from './field-matrix';
import { normalizeProduct, slugify, type NormalizedImportProduct } from './normalize-product';
import {
  normalizeName,
  normalizeSku,
  topNameCandidates,
} from './product-matching';
import type {
  ImportCategoryMode,
  ImportDecisionDto,
  ImportPublishMode,
  StartImportDto,
} from '../dto/import.dto';
import { IMPORT_MAX_DECISIONS, IMPORT_PAGE_SIZE } from '../dto/import.dto';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export type AssignmentDecision = 'create' | 'leave' | 'none';

/**
 * The §15.4 assignment table, as a pure function.
 *
 * - draft ⇒ NO assignment ever (a draft must never appear on any store).
 * - LINK never overwrites an existing assignment.
 * - CREATE-active and LINK-active-with-no-assignment ⇒ create `available=true`.
 * - LINK draft ⇒ no assignment (the caller records the D7 warning).
 */
export function decideAssignment(input: {
  decision: 'create' | 'link';
  /** Local product is live (status active AND isActive). */
  productActive: boolean;
  /** An assignment already exists for (store, product). */
  hasAssignment: boolean;
}): AssignmentDecision {
  if (!input.productActive) return 'none';
  if (input.hasAssignment) return 'leave';
  return 'create';
}

/** Reason grammar (§10.4): `PREFIX` or `PREFIX:detail`. Group by prefix. */
export function reasonPrefix(reason: string): string {
  return (reason ?? '').split(':')[0] || '';
}

/** Store statuses the import flow accepts (PENDING/DISCONNECTED/AUTH_FAILED refuse). */
const IMPORTABLE_STORE_STATUSES = new Set(['CONNECTED', 'ATTENTION_REQUIRED']);

/** Provider pages fetched per catalog request (100 rows each). */
const CATALOG_PROVIDER_PAGE_SIZE = 100;

/** Max variation pages fetched per variable product (1000 variations). */
const MAX_VARIATION_PAGES = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  publishMode: ImportPublishMode;
  categoryMode: ImportCategoryMode;
  categoryId?: string;
  stockTick: boolean;
  skipImages: boolean;
  idempotencyKey?: string;
}

/** Per-page resolution cache (categories/tags/brands/attributes). The
 *  service is a singleton — the cache is created per page job and passed
 *  in via the run context, never stored on the service. */
export interface ImportPageCache {
  categories: Map<string, string>;
  /** Category slugs CREATED during this page (for summary counting). */
  categoriesCreated: Set<string>;
  tags: Map<string, string>;
  brands: Map<string, string>;
  attributes: Map<string, string>;
  attributeValues: Map<string, string>;
  /** assign_one target validated once per page (id or null when missing). */
  assignOneCategoryId?: string | null;
}

export function newImportPageCache(): ImportPageCache {
  return {
    categories: new Map(),
    categoriesCreated: new Set(),
    tags: new Map(),
    brands: new Map(),
    attributes: new Map(),
    attributeValues: new Map(),
  };
}

export interface ImportRunContext {
  batchRunId: string;
  childRunId: string;
  storeId: string;
  store: { id: string; kind: string; status: string; name?: string };
  provider: CommerceProvider;
  secrets: StoreWithSecrets;
  options: ImportOptions;
  initiatedById?: string;
  cache: ImportPageCache;
}

export type ImportOutcomeStatus =
  | 'created'
  | 'linked'
  | 'skipped'
  | 'failed'
  | 'remote_deleted';

export interface ImportOutcome {
  status: ImportOutcomeStatus;
  reason: string;
  remoteId: string;
  productId?: string;
  /** True when a background image job was enqueued for this product. */
  imageJobEnqueued: boolean;
  /**
   * Summary deltas for the batch importSummary (successful items only;
   * failed/skipped items carry none). The processor aggregates them per
   * page into batch metadata (see bumpImportSummary).
   */
  variantsImported?: number;
  categoriesCreated?: number;
  categoriesReused?: number;
}

/**
 * Match suggestion (§16). Only the SKU and name tiers produce a `match`;
 * already-linked rows use `alreadyLinked`/`linkedProductId` instead, so
 * the wizard can tell "suggested link" from "already linked" at a glance.
 * Field names follow the agreed frontend contract (phase-2 alignment).
 */
export interface CatalogMatch {
  productId: string;
  name: string;
  sku?: string;
  kind: 'SKU' | 'NAME';
}

export interface CatalogRow {
  remoteId: string;
  name: string;
  slug?: string;
  sku?: string;
  type: string;
  status: string | null;
  regularPrice?: number;
  salePrice?: number;
  /**
   * Min display price (Woo `price`, falling back to `regular_price`).
   * `priceMax` is NOT provided: the list payload carries no max for
   * variable products — computing it needs a variation fetch per product.
   */
  priceMin?: number;
  stockQuantity?: number;
  stockStatus?: string | null;
  manageStock?: boolean;
  imageUrl?: string | null;
  imageCount?: number;
  categories?: Array<{ id?: string; name: string; slug?: string; path?: string }>;
  variantCount?: number;
  /**
   * NOT provided in v1: counting matched variations needs a variation
   * fetch per variable product on the page (one extra provider call each).
   */
  variantsMatched?: number;
  match?: CatalogMatch;
  secondCandidate?: CatalogMatch;
  alreadyLinked?: boolean;
  linkedProductId?: string;
  linkedProductName?: string;
  skipped?: boolean;
  skipNote?: string;
  skippedAt?: Date;
  isNew?: boolean;
  /**
   * NOT provided in v1: detecting variation-SKU collisions needs a
   * variation fetch per variable product (same cost as variantsMatched).
   * Variation collisions still fail the item at import time with
   * VARIANT_SKU_COLLISION.
   */
  variantSkuCollision?: boolean;
  /** True for grouped/external products, which v1 cannot import. */
  unsupportedType?: boolean;
}

export interface CatalogResult {
  data: CatalogRow[];
  meta: {
    /** Provider-reported total (unfiltered); approximate under match filters. */
    total: number | null;
    page: number;
    perPage: number;
    /**
     * Pages in the unfiltered provider catalog; under match filters the
     * filtered page count is smaller. When the provider reports no total,
     * derived from hasMore (page+1 while more pages exist, else page).
     */
    totalPages: number;
  };
  /**
   * Remote categories seen on the fetched page (deduplicated), for the
   * catalog filter dropdown. Only the fetched window is represented —
   * categories on other pages are not listed in v1.
   */
  remoteCategories?: Array<{ id?: string; name: string; slug?: string; path?: string }>;
}

export interface ImportBatchMetadata {
  import: ImportOptions & {
    pageCount: number;
    imageJobsTotal: number;
    decisions: ImportDecisionDto[];
    retriesRunId?: string;
    /** Accumulated per-page summary deltas (see bumpImportSummary). */
    summary?: { variantsImported: number; categoriesCreated: number; categoriesReused: number };
  };
}

/**
 * Second-row result counts for the import result screen (frontend
 * contract point 4, optional `importSummary` on run detail). Category /
 * variant counts come from accumulated batch metadata; image counts are
 * live from the IMAGES_* run items.
 */
export interface ImportSummary {
  categoriesCreated: number;
  categoriesReused: number;
  variantsImported: number;
  imagesDownloaded: number;
  imagesPending: number;
  imagesFailed: number;
}

export interface ImageStatus {
  /** Image jobs enqueued so far (grows as pages complete). */
  total: number;
  /** Image jobs finished (ok + partial + failed). */
  completed: number;
  pending: number;
  /** Jobs where every image failed. */
  failed: number;
  downloaded: number;
  failedImages: number;
}

@Injectable()
export class StoreProductImportService {
  private readonly logger = new Logger(StoreProductImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly registry: ProviderRegistryService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly ownership: FieldOwnershipService,
    private readonly limits: TenantLimitsService,
    private readonly stockSync: StockStatusSyncService,
  ) {}

  // -------------------------------------------------------------------------
  // Catalog (§7.2)
  // -------------------------------------------------------------------------

  /**
   * Review catalog: one provider page (100 rows) annotated with match
   * suggestions, already-linked + skip + "new since last import" flags.
   * Response shape follows the agreed frontend contract (phase-2
   * alignment): `{ data, meta: { total, page, perPage, totalPages },
   * remoteCategories }`.
   *
   * Paging model: the UI page maps onto the provider page that contains it
   * (`providerPage = floor((uiPage-1)*uiPageSize / 100) + 1`); match /
   * category / stock filters apply in-memory on the fetched window, then
   * the UI slice is taken. Search and status go to the provider. Under a
   * match filter the UI page may be short and `total` is the unfiltered
   * provider total — a full-catalog scan for exact filtered paging is
   * future work, not v1.
   *
   * `match=all` (and an absent match param) = all EXCEPT skipped (design
   * §2.3 default). The other match filters show skipped rows when they
   * match the filter — the wizard lets the operator act on a skipped row
   * (e.g. Link it, which deletes the skip).
   */
  async fetchCatalog(
    storeId: string,
    query: {
      page?: number;
      pageSize?: number;
      search?: string;
      status?: string;
      match?: string;
      category?: string;
      stock?: string;
      modifiedAfter?: string;
    },
  ): Promise<CatalogResult> {
    const { provider, secrets } = await this.requireImportableStore(storeId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(Math.max(1, query.pageSize ?? 10), 100);
    const providerPage =
      Math.floor(((page - 1) * pageSize) / CATALOG_PROVIDER_PAGE_SIZE) + 1;

    const { products, hasMore: providerHasMore, total } = await provider.listProducts(
      secrets,
      {
        page: providerPage,
        pageSize: CATALOG_PROVIDER_PAGE_SIZE,
        status: query.status ? [query.status] : ['publish', 'draft'],
        search: query.search?.trim() || undefined,
        modifiedAfter: query.modifiedAfter ? new Date(query.modifiedAfter) : undefined,
      },
    );

    // "New since last import": created after the last batch run started.
    // No prior import run ⇒ nothing is "new" (everything is first sight).
    const lastImport = await this.prisma.syncRun.findFirst({
      where: { storeId, scope: 'PRODUCT_IMPORT' as any, parentRunId: null },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    const rows = await this.annotateCatalogRows(
      storeId,
      products,
      lastImport?.startedAt ?? null,
    );

    // In-memory filters on the fetched window.
    const matchFilter = query.match ?? 'all';
    let filtered = rows.filter((r) => {
      switch (matchFilter) {
        case 'all':
          return !r.skipped;
        case 'linked':
          return r.alreadyLinked === true;
        case 'matched':
          return r.match !== undefined;
        case 'unmatched':
          return r.match === undefined && !r.alreadyLinked;
        case 'skipped':
          return r.skipped === true;
        case 'new':
          return r.isNew === true;
        default:
          return true;
      }
    });
    if (query.category?.trim()) {
      const slug = query.category.trim().toLowerCase();
      filtered = filtered.filter((r) =>
        (r.categories ?? []).some((c) => (c.slug ?? '').toLowerCase() === slug),
      );
    }
    if (query.stock?.trim()) {
      filtered = filtered.filter((r) => r.stockStatus === query.stock!.trim());
    }

    // Remote categories seen on the fetched window, deduplicated by slug.
    const remoteCategories = new Map<string, { id?: string; name: string; slug?: string }>();
    for (const r of rows) {
      for (const c of r.categories ?? []) {
        const key = (c.slug ?? c.name).toLowerCase();
        if (!remoteCategories.has(key)) {
          remoteCategories.set(key, { id: c.id, name: c.name, slug: c.slug });
        }
      }
    }

    const offsetInWindow = (page - 1) * pageSize - (providerPage - 1) * CATALOG_PROVIDER_PAGE_SIZE;
    const data = filtered.slice(offsetInWindow, offsetInWindow + pageSize);
    const hasMore = providerHasMore || offsetInWindow + pageSize < filtered.length;
    const totalPages =
      total != null
        ? Math.max(1, Math.ceil(total / pageSize))
        : hasMore
          ? page + 1
          : page;
    return {
      data,
      meta: { total: total ?? null, page, perPage: pageSize, totalPages },
      remoteCategories: [...remoteCategories.values()],
    };
  }

  private async annotateCatalogRows(
    storeId: string,
    products: NormalizedProduct[],
    lastImportAt: Date | null,
  ): Promise<CatalogRow[]> {
    const bodies = products as Array<Record<string, unknown>>;
    const remoteIds = bodies.map((b) => String(b.id ?? '')).filter(Boolean);

    const [mappings, skips] = await Promise.all([
      this.prisma.storeProductMapping.findMany({
        where: { storeId, externalId: { in: remoteIds } },
        select: { externalId: true, productId: true },
      }),
      this.prisma.storeProductImportSkip.findMany({
        where: { storeId, externalId: { in: remoteIds } },
        select: { externalId: true, note: true, skippedAt: true },
      }),
    ]);
    const mappingByExternal = new Map(mappings.map((m) => [m.externalId, m]));
    const skipByExternal = new Map(skips.map((s) => [s.externalId, s]));
    // StoreProductMapping has no product relation — resolve linked
    // products' display names in one follow-up query.
    const linkedProducts = mappings.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: mappings.map((m) => m.productId) } },
          select: { id: true, name: true, sku: true },
        })
      : [];
    const linkedById = new Map(linkedProducts.map((p) => [p.id, p]));

    // Tier 1 — normalized exact SKU. The IN list carries raw + lowercased +
    // trimmed-lowercased variants so case/whitespace-only differences are
    // still found by the (case-sensitive) DB match; the final comparison is
    // normalized in-memory.
    const remoteSkus = bodies
      .map((b) => String(b.sku ?? '').trim())
      .filter(Boolean);
    const skuCandidates = new Set<string>();
    for (const sku of remoteSkus) {
      skuCandidates.add(sku);
      skuCandidates.add(sku.toLowerCase());
      skuCandidates.add(normalizeSku(sku));
    }
    const [skuProducts, skuVariants] =
      skuCandidates.size > 0
        ? await Promise.all([
            this.prisma.product.findMany({
              where: { sku: { in: [...skuCandidates] } },
              select: { id: true, name: true, sku: true },
            }),
            this.prisma.productVariant.findMany({
              where: { sku: { in: [...skuCandidates] } },
              select: {
                sku: true,
                productId: true,
                product: { select: { id: true, name: true, sku: true } },
              },
            }),
          ])
        : [[], []];
    const productByNormSku = new Map<string, { id: string; name: string; sku: string | null }>();
    for (const p of skuProducts) {
      if (p.sku) productByNormSku.set(normalizeSku(p.sku), p);
    }
    for (const v of skuVariants) {
      const key = normalizeSku(v.sku);
      if (!productByNormSku.has(key) && v.product) {
        productByNormSku.set(key, v.product);
      }
    }

    // Tier 2 — name similarity. One pooled query over the distinct first
    // words (≥3 chars) of the remote names, scored in-memory per row.
    const firstWords = new Set<string>();
    for (const b of bodies) {
      const first = normalizeName(String(b.name ?? '')).split(' ')[0] ?? '';
      if (first.length >= 3) firstWords.add(first);
    }
    const namePool =
      firstWords.size > 0
        ? await this.prisma.product.findMany({
            where: {
              OR: [...firstWords].map((w) => ({
                name: { contains: w, mode: 'insensitive' as const },
              })),
            },
            take: 50,
            select: { id: true, name: true, sku: true },
          })
        : [];

    return bodies.map((b) => {
      const remoteId = String(b.id ?? '');
      const type = String(b.type ?? 'simple').toLowerCase();
      const images = Array.isArray(b.images) ? b.images : [];
      const variations = Array.isArray(b.variations) ? b.variations : [];
      const categories = (Array.isArray(b.categories) ? b.categories : [])
        .map((c: any) => ({
          id: c.id != null ? String(c.id) : undefined,
          name: String(c.name ?? ''),
          slug: String(c.slug ?? '') || undefined,
        }))
        .filter((c) => c.name.length > 0);

      // Already-linked outranks all tiers (§16.2): the row carries the
      // link fields and NO match suggestion.
      const mapping = mappingByExternal.get(remoteId);
      const linked = mapping ? linkedById.get(mapping.productId) : undefined;
      let match: CatalogMatch | undefined;
      let secondCandidate: CatalogMatch | undefined;
      if (!mapping) {
        const remoteSku = String(b.sku ?? '').trim();
        const skuHit = remoteSku ? productByNormSku.get(normalizeSku(remoteSku)) : undefined;
        if (skuHit) {
          match = {
            productId: skuHit.id,
            name: skuHit.name,
            sku: skuHit.sku ?? undefined,
            kind: 'SKU',
          };
        } else {
          const candidates = topNameCandidates(String(b.name ?? ''), namePool);
          if (candidates.length > 0) {
            match = {
              productId: candidates[0].id,
              name: candidates[0].name,
              sku: candidates[0].sku ?? undefined,
              kind: 'NAME',
            };
            if (candidates.length > 1) {
              secondCandidate = {
                productId: candidates[1].id,
                name: candidates[1].name,
                sku: candidates[1].sku ?? undefined,
                kind: 'NAME',
              };
            }
          }
        }
      }

      const skip = skipByExternal.get(remoteId);
      const toPrice = (v: unknown): number | undefined => {
        if (v === null || v === undefined || v === '') return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      const regularPrice = toPrice(b.regular_price);
      const createdAt = String(b.date_created ?? '') || null;
      const row: CatalogRow = {
        remoteId,
        name: String(b.name ?? ''),
        slug: String(b.slug ?? '') || undefined,
        sku: String(b.sku ?? '').trim() || undefined,
        type,
        status: String(b.status ?? '') || null,
        regularPrice,
        salePrice: toPrice(b.sale_price),
        priceMin: toPrice(b.price) ?? regularPrice,
        stockStatus: String(b.stock_status ?? '') || null,
        stockQuantity: Math.max(0, Math.floor(Number(b.stock_quantity ?? 0)) || 0),
        manageStock: b.manage_stock === true,
        categories,
        imageUrl: (images[0] as any)?.src ? String((images[0] as any).src) : null,
        imageCount: images.length,
        variantCount: variations.length,
        match,
        secondCandidate,
        alreadyLinked: mapping !== undefined,
        linkedProductId: mapping?.productId,
        linkedProductName: linked?.name,
        skipped: skip !== undefined,
        skipNote: skip?.note ?? undefined,
        skippedAt: skip?.skippedAt,
        isNew:
          lastImportAt !== null &&
          createdAt !== null &&
          new Date(createdAt).getTime() > lastImportAt.getTime(),
        unsupportedType: type === 'grouped' || type === 'external',
      };
      return row;
    });
  }

  // -------------------------------------------------------------------------
  // Confirm (§7.1, §10.3, §13.4)
  // -------------------------------------------------------------------------

  /**
   * Confirm the review: validate, quota pre-check, create the batch run,
   * fan out page jobs. Returns immediately with the batch run id.
   */
  async startImport(
    storeId: string,
    dto: StartImportDto,
    initiatedById?: string,
  ): Promise<{ runId: string; deduped: boolean }> {
    if (!productImportEnabled(process.env)) {
      throw new ForbiddenException(
        'Product import is disabled for this deployment (store_product_import_enabled).',
      );
    }
    const { store } = await this.requireImportableStore(storeId);
    void store;
    const decisions = dto.decisions ?? [];
    if (decisions.length === 0) {
      throw new BadRequestException('At least one decision is required.');
    }
    if (decisions.length > IMPORT_MAX_DECISIONS) {
      throw new BadRequestException(
        `At most ${IMPORT_MAX_DECISIONS} decisions per import (100 pages of 100). Split the import and retry.`,
      );
    }
    const seenRemote = new Set<string>();
    for (const d of decisions) {
      if (seenRemote.has(d.remoteId)) {
        throw new BadRequestException(`Duplicate decision for remote product ${d.remoteId}.`);
      }
      seenRemote.add(d.remoteId);
      if (d.action === 'link' && !d.productId) {
        throw new BadRequestException(
          `Link decision for remote product ${d.remoteId} is missing its local product.`,
        );
      }
    }
    if (dto.categoryMode === 'assign_one') {
      if (!dto.categoryId) {
        throw new BadRequestException('categoryId is required for assign_one category mode.');
      }
      const cat = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!cat) {
        throw new BadRequestException(`Category ${dto.categoryId} does not exist.`);
      }
    }
    const linkTargetIds = [...new Set(decisions.filter((d) => d.action === 'link').map((d) => d.productId!))];
    if (linkTargetIds.length > 0) {
      const found = await this.prisma.product.findMany({
        where: { id: { in: linkTargetIds } },
        select: { id: true },
      });
      const foundIds = new Set(found.map((p) => p.id));
      const missing = linkTargetIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Link target product(s) not found: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ''}.`,
        );
      }
    }

    const options: ImportOptions = {
      publishMode: dto.publishMode,
      categoryMode: dto.categoryMode,
      categoryId: dto.categoryId,
      stockTick: dto.stockTick ?? true,
      skipImages: dto.skipImages ?? false,
      idempotencyKey: dto.idempotencyKey,
    };

    // Quota pre-check (§13.4): count create decisions that will land
    // active (publish-status remotes; an unknown remoteStatus counts as
    // publish — conservative). Drafts are quota-free.
    if (options.publishMode === 'active') {
      const activeBound = decisions.filter(
        (d) => d.action === 'create' && d.remoteStatus !== 'draft' && d.remoteStatus !== 'private',
      ).length;
      const limit = this.limits.getLimit('products');
      if (limit !== null && activeBound > 0) {
        const used = await this.limits.getUsage('products');
        if (used + activeBound > limit) {
          throw new BadRequestException(
            `Product quota: ${used}/${limit} used, this import would add ${activeBound} active products (shortfall ${used + activeBound - limit}). Import as drafts instead, or upgrade the plan.`,
          );
        }
      }
    }

    // Idempotency (§13.2): same key + same store = the same confirm.
    if (options.idempotencyKey) {
      const existing = await this.prisma.syncRun.findFirst({
        where: {
          storeId,
          scope: 'PRODUCT_IMPORT' as any,
          parentRunId: null,
          metadata: {
            path: ['import', 'idempotencyKey'],
            equals: options.idempotencyKey,
          } as any,
        },
        select: { id: true },
      });
      if (existing) {
        return { runId: existing.id, deduped: true };
      }
    }

    const pageCount = Math.ceil(decisions.length / IMPORT_PAGE_SIZE);
    const metadata: ImportBatchMetadata = {
      import: { ...options, pageCount, imageJobsTotal: 0, decisions },
    };
    const batch = await this.runs.begin({
      scope: 'PRODUCT_IMPORT',
      triggerType: 'MANUAL',
      storeId,
      initiatedById,
      metadata: metadata as unknown as Record<string, unknown>,
    });
    await this.prisma.syncRun.update({
      where: { id: batch.id },
      data: { totalCount: decisions.length },
    });

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pageDecisions = decisions.slice(
        pageIndex * IMPORT_PAGE_SIZE,
        (pageIndex + 1) * IMPORT_PAGE_SIZE,
      );
      await this.queues.enqueue(
        'store-product-import',
        'import-page',
        { batchRunId: batch.id, storeId, pageIndex, decisions: pageDecisions },
        `import-page-${batch.id}-${pageIndex}`,
      );
    }
    return { runId: batch.id, deduped: false };
  }

  // -------------------------------------------------------------------------
  // Per-item import (§15)
  // -------------------------------------------------------------------------

  /**
   * Import one remote product. `remote` is the body the page job already
   * fetched (null when the include[] list omitted it — the stale-page /
   * deleted case, disambiguated here via fetchProduct).
   *
   * Known outcomes record their own run item and return an outcome. Truly
   * unexpected errors THROW — the processor catches them per item and
   * records FAILED:UNEXPECTED so one poisoned item never aborts the page.
   */
  async importOne(
    ctx: ImportRunContext,
    input: {
      remote: NormalizedProduct | null;
      variations: NormalizedVariant[];
      decision: ImportDecisionDto;
    },
  ): Promise<ImportOutcome> {
    const { decision } = input;
    const remoteId = decision.remoteId;
    let remote = input.remote;
    let variations = input.variations;

    // The include[] list omits trashed/deleted products. A fetchProduct
    // disambiguates: 200 = exists in another status (use the body),
    // 404 = remote gone (R10).
    if (!remote) {
      try {
        remote = await ctx.provider.fetchProduct(ctx.secrets, { providerId: remoteId });
        if (String((remote as Record<string, unknown>).type ?? '') === 'variable') {
          variations = await this.fetchAllVariations(ctx, remoteId);
        }
      } catch (err) {
        if (this.isRemoteNotFound(err)) {
          return this.handleRemoteGone(ctx, decision);
        }
        throw err;
      }
    }

    const normalized = normalizeProduct(remote as Record<string, unknown>, variations as Array<Record<string, unknown>>, {
      publishMode: ctx.options.publishMode,
      stockTick: ctx.options.stockTick,
    });

    // R2 re-import: the mapping exists and the remote still exists — skip
    // and report only. No field ever refreshes from Woo.
    const existing = await this.prisma.storeProductMapping.findUnique({
      where: { storeId_externalId: { storeId: ctx.storeId, externalId: remoteId } },
      select: { productId: true },
    });
    if (existing) {
      await this.recordItem(ctx, {
        productId: existing.productId,
        externalObjectId: remoteId,
        status: 'SKIPPED',
        reason: 'SKIPPED:ALREADY_LINKED',
      });
      return { status: 'skipped', reason: 'SKIPPED:ALREADY_LINKED', remoteId, productId: existing.productId, imageJobEnqueued: false };
    }

    if (decision.action === 'skip') {
      await this.prisma.storeProductImportSkip.upsert({
        where: { storeId_externalId: { storeId: ctx.storeId, externalId: remoteId } },
        create: {
          storeId: ctx.storeId,
          externalId: remoteId,
          note: decision.note ?? null,
          skippedBy: ctx.initiatedById ?? null,
        },
        update: { note: decision.note ?? null, skippedBy: ctx.initiatedById ?? null, skippedAt: new Date() },
      });
      await this.recordItem(ctx, {
        externalObjectId: remoteId,
        status: 'SKIPPED',
        reason: 'SKIPPED:DECISION',
      });
      return { status: 'skipped', reason: 'SKIPPED:DECISION', remoteId, imageJobEnqueued: false };
    }

    if (decision.action === 'link') {
      return this.linkProduct(ctx, decision, normalized, remote as Record<string, unknown>, variations);
    }
    return this.createProduct(ctx, decision, normalized, remote as Record<string, unknown>);
  }

  /** All variations for a variable product (bounded: 10 pages × 100). */
  async fetchAllVariations(
    ctx: Pick<ImportRunContext, 'provider' | 'secrets'>,
    remoteId: string,
  ): Promise<NormalizedVariant[]> {
    const out: NormalizedVariant[] = [];
    for (let page = 1; page <= MAX_VARIATION_PAGES; page += 1) {
      const res = await ctx.provider.listVariations(
        ctx.secrets,
        { providerId: remoteId },
        { page, pageSize: 100 },
      );
      out.push(...res.variations);
      if (!res.hasMore) break;
    }
    return out;
  }

  // ---- LINK (§15.5 minus step 5, R1/R2/R9) ----

  private async linkProduct(
    ctx: ImportRunContext,
    decision: ImportDecisionDto,
    normalized: NormalizedImportProduct,
    remoteBody: Record<string, unknown>,
    variations: NormalizedVariant[],
  ): Promise<ImportOutcome> {
    const remoteId = decision.remoteId;
    const productId = decision.productId!;
    const local = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { include: { attributeValues: true } },
        productTags: true,
      },
    });
    if (!local) {
      return this.fail(ctx, remoteId, 'FAILED:LINK_TARGET_MISSING', `Link target product ${productId} no longer exists.`);
    }
    const clash = await this.prisma.storeProductMapping.findUnique({
      where: { storeId_productId: { storeId: ctx.storeId, productId } },
      select: { externalId: true },
    });
    if (clash) {
      return this.fail(
        ctx,
        remoteId,
        'FAILED:LINK_CONFLICT',
        `Product is already linked to remote product ${clash.externalId} on this store.`,
        productId,
      );
    }

    // Variant matching by SKU (normalized). Unmatched variations are left
    // unmapped — never a failure.
    const localBySku = new Map<string, { id: string }>();
    for (const v of local.variants) localBySku.set(normalizeSku(v.sku), v);
    const variantPairs: Array<{ variantId: string; externalId: string }> = [];
    for (const v of variations as Array<Record<string, unknown>>) {
      const sku = String(v.sku ?? '').trim();
      if (!sku) continue;
      const hit = localBySku.get(normalizeSku(sku));
      if (hit) variantPairs.push({ variantId: hit.id, externalId: String(v.id) });
    }

    // Baseline snapshots from the already-fetched body (no extra GET);
    // providers without the method fall back to readProductFields.
    const fields: FieldKey[] = ctx.provider.syncedFields ?? [];
    const snapshots = await this.snapshotsFor(ctx, remoteBody, remoteId, fields);
    const ecoFields = readEcoMateFields(local);
    const baselineRows = this.adoptBaselines(fields, snapshots, ecoFields, ctx.provider);

    const assignment = await this.prisma.productStoreAssignment.findUnique({
      where: { storeId_productId: { storeId: ctx.storeId, productId } },
      select: { id: true },
    });
    const productActive = local.status !== 'draft' && local.isActive;
    const assignmentAction = decideAssignment({
      decision: 'link',
      productActive,
      hasAssignment: assignment !== null,
    });

    // R9: anchor on the LOCAL sku; alias the remote sku when different.
    // Each upsert is guarded by the no-steal rule (never overwrite a
    // pointer to another product — record SKU_MISMATCH instead).
    const localSku = (local.sku ?? '').trim();
    const remoteSku = String(remoteBody.sku ?? '').trim();
    const skuTargets: string[] = [];
    if (localSku) skuTargets.push(localSku);
    if (remoteSku && normalizeSku(remoteSku) !== normalizeSku(localSku)) skuTargets.push(remoteSku);

    let skuMismatch: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.storeProductMapping.create({
          data: {
            storeId: ctx.storeId,
            productId,
            externalId: remoteId,
            externalUrl: normalized.externalUrl,
            origin: 'IMPORT_LINK',
          },
        });
        for (const pair of variantPairs) {
          await tx.storeVariantMapping.create({
            data: {
              storeId: ctx.storeId,
              productId,
              variantId: pair.variantId,
              externalId: pair.externalId,
              origin: 'IMPORT_LINK',
            },
          });
        }
        for (const row of baselineRows) {
          await tx.productStoreFieldState.upsert({
            where: { storeId_productId_field: { storeId: ctx.storeId, productId, field: row.field } },
            create: {
              storeId: ctx.storeId,
              productId,
              field: row.field,
              ownership: row.ownership as any,
              baselineHash: row.baselineHash,
              externalHash: row.externalHash,
              ecoMateHashAtRebase: row.ecoMateHashAtRebase,
              evidence: row.evidence as any,
            },
            update: {
              ownership: row.ownership as any,
              baselineHash: row.baselineHash,
              externalHash: row.externalHash,
              ecoMateHashAtRebase: row.ecoMateHashAtRebase,
              evidence: row.evidence as any,
            },
          });
        }
        if (assignmentAction === 'create') {
          await tx.productStoreAssignment.create({
            data: { storeId: ctx.storeId, productId, source: 'MANUAL', available: true },
          });
        }
        for (const sku of skuTargets) {
          const held = await tx.storeSkuMapping.findUnique({
            where: { storeId_sku: { storeId: ctx.storeId, sku } },
            select: { productId: true },
          });
          if (held && held.productId && held.productId !== productId) {
            skuMismatch = sku;
            continue;
          }
          await tx.storeSkuMapping.upsert({
            where: { storeId_sku: { storeId: ctx.storeId, sku } },
            create: { storeId: ctx.storeId, sku, productId },
            update: { productId },
          });
        }
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        // Race net (order ingest / a concurrent import linked first).
        const raced = await this.prisma.storeProductMapping.findUnique({
          where: { storeId_externalId: { storeId: ctx.storeId, externalId: remoteId } },
          select: { productId: true },
        });
        await this.recordItem(ctx, {
          productId: raced?.productId ?? productId,
          externalObjectId: remoteId,
          status: 'SKIPPED',
          reason: 'SKIPPED:ALREADY_LINKED',
        });
        return { status: 'skipped', reason: 'SKIPPED:ALREADY_LINKED', remoteId, productId: raced?.productId ?? productId, imageJobEnqueued: false };
      }
      throw err;
    }

    if (skuMismatch) {
      await this.runs.upsertIssue({
        storeId: ctx.storeId,
        code: 'SKU_MISMATCH',
        objectType: 'PRODUCT',
        objectKey: remoteId,
        productId,
        message: `SKU ${skuMismatch} already maps to another product on this store; the link kept the existing pointer.`,
      });
    }

    // D7: draft link is allowed, with a warning carried on the reason.
    const reason = productActive ? 'LINKED' : 'LINKED:DRAFT_NO_ASSIGNMENT';
    await this.recordItem(ctx, {
      productId,
      externalObjectId: remoteId,
      status: 'SUCCESS',
      reason,
    });
    return {
      status: 'linked',
      reason,
      remoteId,
      productId,
      imageJobEnqueued: false,
      variantsImported: variantPairs.length,
    };
  }

  // ---- CREATE (§15.1/§15.2) ----

  private async createProduct(
    ctx: ImportRunContext,
    decision: ImportDecisionDto,
    normalized: NormalizedImportProduct,
    remoteBody: Record<string, unknown>,
  ): Promise<ImportOutcome> {
    const remoteId = decision.remoteId;

    if (!normalized.supported) {
      await this.recordItem(ctx, {
        externalObjectId: remoteId,
        status: 'SKIPPED',
        reason: 'SKIPPED:UNSUPPORTED_TYPE',
      });
      return { status: 'skipped', reason: 'SKIPPED:UNSUPPORTED_TYPE', remoteId, imageJobEnqueued: false };
    }

    // Per-create quota check (the precise gate; the confirm pre-check is
    // the estimate). Drafts are quota-free.
    if (normalized.status === 'active') {
      try {
        await this.limits.assertWithinLimit('products', 1);
      } catch (err) {
        if (err instanceof ForbiddenException) {
          return this.fail(ctx, remoteId, 'FAILED:QUOTA', err.message);
        }
        throw err;
      }
    }

    // E2: a duplicate variant SKU fails the whole product (variant SKUs
    // are unique per tenant). Within-batch dupes count too.
    const variantSkus = normalized.variants.map((v) => v.sku).filter(Boolean);
    const seenSkus = new Set<string>();
    for (const sku of variantSkus) {
      if (seenSkus.has(sku)) {
        return this.fail(ctx, remoteId, 'FAILED:VARIANT_SKU_COLLISION', `Variant SKU ${sku} appears twice in the remote product.`);
      }
      seenSkus.add(sku);
    }
    if (variantSkus.length > 0) {
      const clash = await this.prisma.productVariant.findFirst({
        where: { sku: { in: variantSkus } },
        select: { sku: true },
      });
      if (clash) {
        return this.fail(ctx, remoteId, 'FAILED:VARIANT_SKU_COLLISION', `Variant SKU ${clash.sku} is already in use by another product.`);
      }
    }

    // E1: a duplicate PRODUCT sku is a warning, not a failure (Product.sku
    // is not unique). Recorded as an issue after the create commits.
    const skuCollision =
      normalized.sku.length > 0
        ? await this.prisma.product.findFirst({
            where: { sku: normalized.sku },
            select: { id: true },
          })
        : null;

    const catStats = await this.resolveCategoryIds(ctx, normalized);
    if (catStats === null) {
      return this.fail(ctx, remoteId, 'FAILED:CATEGORY_MISSING', 'The assign-one category no longer exists.');
    }
    const categoryIds = catStats.ids;
    const tagIds = await this.resolveTagIds(ctx, normalized.tags);
    const brandId = normalized.brandName
      ? await this.resolveBrandId(ctx, normalized.brandName)
      : null;

    // Attribute axes (variation attributes only — non-variation attributes
    // live in seoMeta per §8.1 row 12).
    const axisAttrs = normalized.attributes.filter((a) => a.variation);
    const attrValueIds = new Map<string, Map<string, string>>(); // attrName → value → id
    for (const attr of axisAttrs) {
      const attributeId = await this.resolveAttributeId(ctx, attr.name);
      const byValue = new Map<string, string>();
      for (const option of attr.options) {
        byValue.set(option, await this.resolveAttributeValueId(ctx, attributeId, option));
      }
      attrValueIds.set(attr.name, byValue);
    }

    const fields: FieldKey[] = ctx.provider.syncedFields ?? [];
    const snapshots = await this.snapshotsFor(ctx, remoteBody, remoteId, fields);

    const type = normalized.variants.length > 0 ? 'variable' : 'simple';
    const effectivePrice = computeEffectivePrice(
      { type, basePrice: normalized.basePrice, salePrice: normalized.salePrice ?? undefined },
      normalized.variants.map((v) => ({ price: v.price, salePrice: v.salePrice ?? undefined })),
    );

    // Slug uniqueness (suffix -2, -3…; one P2002 retry with a random tail).
    const slug = await this.ensureUniqueSlug(normalized.slug);

    const createOnce = async (slugAttempt: string) => {
      let createdProductId = '';
      let createdVariants: Array<{ id: string; sku: string; price: unknown; salePrice: unknown; isActive: boolean }> = [];
      let skuMismatch = false;
      await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name: normalized.name,
            slug: slugAttempt,
            type,
            description: normalized.description,
            shortDesc: normalized.shortDescription,
            basePrice: normalized.basePrice,
            salePrice: normalized.salePrice,
            effectivePrice,
            sku: normalized.sku,
            // R4: one-time MANAGED-STOCK seed. Physical inventory is
            // NEVER written here (it needs cost price; Woo has none).
            managedStockQuantity: normalized.stock.manageStock ? normalized.stock.quantity : 0,
            manageStock: normalized.stock.manageStock,
            availabilityMode: 'MANAGED_STOCK',
            categoryId: categoryIds[0] ?? null,
            tags: normalized.tags,
            images: [],
            seoMeta: normalized.seoMeta as any,
            isActive: normalized.isActive,
            status: normalized.status,
            brandId,
          },
        });
        createdProductId = product.id;
        for (const [idx, v] of normalized.variants.entries()) {
          const variant = await tx.productVariant.create({
            data: {
              productId: product.id,
              sku: v.sku,
              sortOrder: idx,
              price: v.price,
              salePrice: v.salePrice,
              managedStockQuantity: v.manageStock ? v.stockQuantity : 0,
              image: v.imageSrc,
              isActive: v.isActive,
            },
          });
          createdVariants.push({
            id: variant.id,
            sku: variant.sku,
            price: variant.price,
            salePrice: variant.salePrice,
            isActive: variant.isActive,
          });
          for (const attr of v.attributes) {
            const valueId = attrValueIds.get(attr.name)?.get(attr.value);
            if (!valueId) continue;
            await tx.productVariantAttributeValue.create({
              data: { variantId: variant.id, attributeValueId: valueId },
            });
          }
        }
        const seenCategories = new Set<string>();
        for (const categoryId of categoryIds) {
          if (seenCategories.has(categoryId)) continue;
          seenCategories.add(categoryId);
          await tx.productCategory.create({ data: { productId: product.id, categoryId } });
        }
        for (const tagId of tagIds) {
          await tx.productTag.create({ data: { productId: product.id, tagId } });
        }
        await tx.storeProductMapping.create({
          data: {
            storeId: ctx.storeId,
            productId: product.id,
            externalId: remoteId,
            externalUrl: normalized.externalUrl,
            origin: 'IMPORT_CREATE',
          },
        });
        for (let i = 0; i < normalized.variants.length; i += 1) {
          await tx.storeVariantMapping.create({
            data: {
              storeId: ctx.storeId,
              productId: product.id,
              variantId: createdVariants[i].id,
              externalId: normalized.variants[i].externalId,
              origin: 'IMPORT_CREATE',
            },
          });
        }
        // Baseline seeding (§17.1): adoptExisting over the just-created
        // local shape vs the remote snapshots. This writes FieldState
        // rows, never product fields (R2).
        const ecoFields = readEcoMateFields({
          ...product,
          variants: createdVariants.map((v) => ({
            ...v,
            attributeValues: [],
          })),
          productTags: normalized.tags,
        });
        for (const row of this.adoptBaselines(fields, snapshots, ecoFields, ctx.provider)) {
          await tx.productStoreFieldState.upsert({
            where: { storeId_productId_field: { storeId: ctx.storeId, productId: product.id, field: row.field } },
            create: {
              storeId: ctx.storeId,
              productId: product.id,
              field: row.field,
              ownership: row.ownership as any,
              baselineHash: row.baselineHash,
              externalHash: row.externalHash,
              ecoMateHashAtRebase: row.ecoMateHashAtRebase,
              evidence: row.evidence as any,
            },
            update: {
              ownership: row.ownership as any,
              baselineHash: row.baselineHash,
              externalHash: row.externalHash,
              ecoMateHashAtRebase: row.ecoMateHashAtRebase,
              evidence: row.evidence as any,
            },
          });
        }
        // §15.4: CREATE-active ⇒ assignment; draft ⇒ none, ever.
        if (decideAssignment({ decision: 'create', productActive: normalized.isActive, hasAssignment: false }) === 'create') {
          await tx.productStoreAssignment.create({
            data: { storeId: ctx.storeId, productId: product.id, source: 'MANUAL', available: true },
          });
        }
        // SKU mapping for the created product's SKU (no-steal guard).
        if (normalized.sku) {
          const held = await tx.storeSkuMapping.findUnique({
            where: { storeId_sku: { storeId: ctx.storeId, sku: normalized.sku } },
            select: { productId: true },
          });
          if (held && held.productId && held.productId !== product.id) {
            skuMismatch = true;
          } else {
            await tx.storeSkuMapping.upsert({
              where: { storeId_sku: { storeId: ctx.storeId, sku: normalized.sku } },
              create: { storeId: ctx.storeId, sku: normalized.sku, productId: product.id },
              update: { productId: product.id },
            });
          }
        }
      });
      return { productId: createdProductId, variants: createdVariants, skuMismatch };
    };

    let created: { productId: string; variants: Array<{ id: string }>; skuMismatch: boolean };
    try {
      created = await createOnce(slug);
    } catch (err) {
      if (this.isUniqueViolation(err) && this.targetIncludes(err, 'slug')) {
        // Slug race (concurrent create took our suffix) — one retry.
        created = await createOnce(`${slug}-${randomUUID().slice(0, 6)}`);
      } else if (this.isUniqueViolation(err)) {
        // Mapping reverse-unique race: someone linked this remote first.
        const raced = await this.prisma.storeProductMapping.findUnique({
          where: { storeId_externalId: { storeId: ctx.storeId, externalId: remoteId } },
          select: { productId: true },
        });
        if (raced) {
          await this.recordItem(ctx, {
            productId: raced.productId,
            externalObjectId: remoteId,
            status: 'SKIPPED',
            reason: 'SKIPPED:ALREADY_LINKED',
          });
          return { status: 'skipped', reason: 'SKIPPED:ALREADY_LINKED', remoteId, productId: raced.productId, imageJobEnqueued: false };
        }
        throw err;
      } else {
        throw err;
      }
    }

    if (skuCollision || created.skuMismatch) {
      await this.runs.upsertIssue({
        storeId: ctx.storeId,
        code: 'SKU_COLLISION',
        objectType: 'PRODUCT',
        objectKey: remoteId,
        productId: created.productId,
        message: `Imported product SKU ${normalized.sku} is already in use by another product; the import kept both products.`,
      });
    }

    // Post-create stock notify (R4 — the managed-layer seed must still
    // propagate to the stock-status pipeline; physical stock untouched).
    void this.stockSync
      .notifyStockChanged(created.productId, null, 'product-import-create')
      .catch(() => undefined);
    for (const v of created.variants) {
      void this.stockSync
        .notifyStockChanged(created.productId, v.id, 'product-import-create')
        .catch(() => undefined);
    }

    // R5: images download in the background; the import never waits.
    let imageJobEnqueued = false;
    if (!ctx.options.skipImages && normalized.images.length > 0) {
      try {
        await this.queues.enqueue(
          'store-product-import-images',
          'import-images',
          {
            batchRunId: ctx.batchRunId,
            storeId: ctx.storeId,
            productId: created.productId,
            externalId: remoteId,
            images: normalized.images,
          },
          `import-images-${ctx.batchRunId}-${created.productId}`,
        );
        imageJobEnqueued = true;
      } catch (err) {
        this.logger.warn(`image job enqueue failed for ${created.productId}: ${(err as Error)?.message ?? err}`);
        await this.runs.upsertIssue({
          storeId: ctx.storeId,
          code: 'IMAGE_ENQUEUE_FAILED',
          objectType: 'PRODUCT',
          objectKey: remoteId,
          productId: created.productId,
          message: 'Product imported but its image-download job could not be queued; retry the import or upload images manually.',
        });
      }
    }

    const reason = normalized.imagesCapped
      ? `CREATED:IMAGE_LIMIT`
      : 'CREATED';
    await this.recordItem(ctx, {
      productId: created.productId,
      externalObjectId: remoteId,
      status: 'SUCCESS',
      reason,
    });
    return {
      status: 'created',
      reason,
      remoteId,
      productId: created.productId,
      imageJobEnqueued,
      variantsImported: created.variants.length,
      categoriesCreated: catStats.created,
      categoriesReused: catStats.reused,
    };
  }

  // ---- Remote gone (R10 / §18.4) ----

  /**
   * fetchProduct 404 on a decision whose remote is mapped: the remote is
   * gone. Import-origin mappings unlink + keep local (D5); push-origin
   * mappings are the push engine's re-create case — import leaves them
   * alone. No mapping: create skips, link fails, skip proceeds.
   */
  private async handleRemoteGone(
    ctx: ImportRunContext,
    decision: ImportDecisionDto,
  ): Promise<ImportOutcome> {
    const remoteId = decision.remoteId;
    const mapping = await this.prisma.storeProductMapping.findUnique({
      where: { storeId_externalId: { storeId: ctx.storeId, externalId: remoteId } },
      select: { productId: true, origin: true },
    });

    if (mapping && (mapping.origin === 'IMPORT_CREATE' || mapping.origin === 'IMPORT_LINK')) {
      await this.prisma.$transaction(async (tx) => {
        await tx.storeVariantMapping.deleteMany({
          where: { storeId: ctx.storeId, productId: mapping.productId },
        });
        await tx.productStoreFieldState.deleteMany({
          where: { storeId: ctx.storeId, productId: mapping.productId },
        });
        await tx.productStoreAssignment.deleteMany({
          where: { storeId: ctx.storeId, productId: mapping.productId },
        });
        await tx.storeProductMapping.delete({
          where: { storeId_externalId: { storeId: ctx.storeId, externalId: remoteId } },
        });
      });
      await this.runs.upsertIssue({
        storeId: ctx.storeId,
        code: 'REMOTE_DELETED',
        objectType: 'PRODUCT',
        objectKey: remoteId,
        productId: mapping.productId,
        message: 'The remote product was deleted; the link was removed and the local product was kept.',
      });
      await this.recordItem(ctx, {
        productId: mapping.productId,
        externalObjectId: remoteId,
        status: 'SKIPPED',
        reason: 'REMOTE_DELETED',
      });
      return { status: 'remote_deleted', reason: 'REMOTE_DELETED', remoteId, productId: mapping.productId, imageJobEnqueued: false };
    }

    if (mapping) {
      // Push-origin: the push engine re-creates it on the next sync.
      await this.recordItem(ctx, {
        productId: mapping.productId,
        externalObjectId: remoteId,
        status: 'SKIPPED',
        reason: 'SKIPPED:ALREADY_LINKED',
      });
      return { status: 'skipped', reason: 'SKIPPED:ALREADY_LINKED', remoteId, productId: mapping.productId, imageJobEnqueued: false };
    }

    if (decision.action === 'skip') {
      await this.prisma.storeProductImportSkip.upsert({
        where: { storeId_externalId: { storeId: ctx.storeId, externalId: remoteId } },
        create: { storeId: ctx.storeId, externalId: remoteId, note: decision.note ?? null, skippedBy: ctx.initiatedById ?? null },
        update: { note: decision.note ?? null, skippedBy: ctx.initiatedById ?? null, skippedAt: new Date() },
      });
      await this.recordItem(ctx, { externalObjectId: remoteId, status: 'SKIPPED', reason: 'SKIPPED:DECISION' });
      return { status: 'skipped', reason: 'SKIPPED:DECISION', remoteId, imageJobEnqueued: false };
    }
    if (decision.action === 'link') {
      return this.fail(ctx, remoteId, 'FAILED:REMOTE_DELETED', 'The remote product no longer exists; nothing to link.');
    }
    await this.recordItem(ctx, { externalObjectId: remoteId, status: 'SKIPPED', reason: 'SKIPPED:REMOTE_DELETED' });
    return { status: 'skipped', reason: 'SKIPPED:REMOTE_DELETED', remoteId, imageJobEnqueued: false };
  }

  // -------------------------------------------------------------------------
  // Retry / counts / image status (§10.4–10.5)
  // -------------------------------------------------------------------------

  /** Retry re-runs FAILED items only, from the decisions stored on the batch run. */
  async retryFailedImport(
    batchRunId: string,
    initiatedById?: string,
    storeId?: string,
  ): Promise<{ runId: string; retried: number }> {
    if (!productImportEnabled(process.env)) {
      throw new ForbiddenException('Product import is disabled for this deployment.');
    }
    const batch = await this.prisma.syncRun.findUnique({ where: { id: batchRunId } });
    if (!batch || (batch as any).scope !== 'PRODUCT_IMPORT' || (batch as any).parentRunId) {
      throw new BadRequestException(`No import batch run ${batchRunId}.`);
    }
    if (storeId && (batch as any).storeId !== storeId) {
      throw new BadRequestException(`Run ${batchRunId} does not belong to this store.`);
    }
    if ((batch as any).status === 'RUNNING') {
      throw new BadRequestException('This import is still running; retry after it finishes.');
    }
    if ((batch as any).status === 'CANCELLED') {
      throw new BadRequestException('A cancelled import cannot be retried; start a new import.');
    }
    const meta = (batch as any).metadata as ImportBatchMetadata | null;
    const stored = meta?.import;
    if (!stored?.decisions?.length) {
      throw new BadRequestException('This run predates retry support (no stored decisions).');
    }
    const { store } = await this.requireImportableStore((batch as any).storeId);
    void store;

    const children = await this.runs.childRuns(batchRunId);
    const failedItems = await this.prisma.syncRunItem.findMany({
      where: { runId: { in: children.map((c) => c.id) }, status: 'FAILED' as any },
      select: { externalObjectId: true },
    });
    const failedIds = new Set(failedItems.map((i) => i.externalObjectId).filter(Boolean));
    const retryDecisions = stored.decisions.filter((d) => failedIds.has(d.remoteId));
    if (retryDecisions.length === 0) {
      throw new BadRequestException('No failed items to retry on this run.');
    }

    const pageCount = Math.ceil(retryDecisions.length / IMPORT_PAGE_SIZE);
    const retryMeta: ImportBatchMetadata = {
      import: {
        ...stored,
        idempotencyKey: `retry:${randomUUID()}`,
        pageCount,
        imageJobsTotal: 0,
        decisions: retryDecisions,
        retriesRunId: batchRunId,
      },
    };
    const retryBatch = await this.runs.begin({
      scope: 'PRODUCT_IMPORT',
      triggerType: 'RETRY',
      storeId: (batch as any).storeId,
      initiatedById,
      metadata: retryMeta as unknown as Record<string, unknown>,
    });
    await this.prisma.syncRun.update({
      where: { id: retryBatch.id },
      data: { totalCount: retryDecisions.length },
    });
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pageDecisions = retryDecisions.slice(
        pageIndex * IMPORT_PAGE_SIZE,
        (pageIndex + 1) * IMPORT_PAGE_SIZE,
      );
      await this.queues.enqueue(
        'store-product-import',
        'import-page',
        { batchRunId: retryBatch.id, storeId: (batch as any).storeId, pageIndex, decisions: pageDecisions },
        `import-page-${retryBatch.id}-${pageIndex}`,
      );
    }
    return { runId: retryBatch.id, retried: retryDecisions.length };
  }

  /** Exact per-reason-prefix counts across a batch + its children (§10.4). */
  async reasonCounts(batchRunId: string): Promise<{ counts: Record<string, number>; total: number }> {
    const children = await this.runs.childRuns(batchRunId);
    const rows = await this.runs.countItemsByReason([batchRunId, ...children.map((c) => c.id)]);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const prefix = reasonPrefix(row.reason);
      counts[prefix] = (counts[prefix] ?? 0) + row.count;
      total += row.count;
    }
    return { counts, total };
  }

  /** Background image progress for a batch (§10.4, R5). */
  async imageStatus(batchRunId: string, storeId?: string): Promise<ImageStatus> {
    const batch = await this.prisma.syncRun.findUnique({
      where: { id: batchRunId },
      select: { metadata: true, storeId: true },
    });
    if (!batch) throw new BadRequestException(`No run ${batchRunId}.`);
    if (storeId && (batch as any).storeId !== storeId) {
      throw new BadRequestException(`Run ${batchRunId} does not belong to this store.`);
    }
    const meta = (batch.metadata as ImportBatchMetadata | null)?.import;
    const total = meta?.imageJobsTotal ?? 0;
    // IMAGES_OK:n / IMAGES_PARTIAL:d/f / IMAGES_FAILED:f carry counts in
    // the detail suffix; groupBy is on the full reason, so parse the raw
    // rows here (reasonCounts groups by prefix and would lose the detail).
    const children = await this.runs.childRuns(batchRunId);
    const rows = await this.runs.countItemsByReason([batchRunId, ...children.map((c) => c.id)]);
    let completed = 0;
    let failed = 0;
    let downloaded = 0;
    let failedImages = 0;
    for (const row of rows) {
      const prefix = reasonPrefix(row.reason);
      const detail = (row.reason ?? '').split(':')[1] ?? '';
      if (prefix === 'IMAGES_OK') {
        completed += row.count;
        downloaded += row.count * (Number(detail) || 0);
      } else if (prefix === 'IMAGES_PARTIAL') {
        completed += row.count;
        const [d, f] = detail.split('/').map(Number);
        downloaded += row.count * (Number.isFinite(d) ? d : 0);
        failedImages += row.count * (Number.isFinite(f) ? f : 0);
      } else if (prefix === 'IMAGES_FAILED') {
        completed += row.count;
        failed += row.count;
        failedImages += row.count * (Number(detail) || 0);
      }
    }
    return {
      total,
      completed,
      pending: Math.max(0, total - completed),
      failed,
      downloaded,
      failedImages,
    };
  }

  /** Page processor bumps the image-job total under the store lock (§10.3). */
  async bumpImageJobsTotal(batchRunId: string, delta: number): Promise<void> {
    if (delta <= 0) return;
    const batch = await this.prisma.syncRun.findUnique({
      where: { id: batchRunId },
      select: { metadata: true },
    });
    const meta = (batch?.metadata as ImportBatchMetadata | null)?.import;
    if (!meta) return;
    await this.prisma.syncRun.update({
      where: { id: batchRunId },
      data: {
        metadata: {
          import: { ...meta, imageJobsTotal: (meta.imageJobsTotal ?? 0) + delta },
        } as any,
      },
    });
  }

  /**
   * Page processor accumulates per-page summary deltas under the store
   * lock (§10.3). Same read-modify-write shape as bumpImageJobsTotal;
   * the store lock serializes pages, so no delta is lost.
   */
  async bumpImportSummary(
    batchRunId: string,
    delta: { variantsImported: number; categoriesCreated: number; categoriesReused: number },
  ): Promise<void> {
    if (delta.variantsImported <= 0 && delta.categoriesCreated <= 0 && delta.categoriesReused <= 0) {
      return;
    }
    const batch = await this.prisma.syncRun.findUnique({
      where: { id: batchRunId },
      select: { metadata: true },
    });
    const meta = (batch?.metadata as ImportBatchMetadata | null)?.import;
    if (!meta) return;
    const prev = meta.summary ?? { variantsImported: 0, categoriesCreated: 0, categoriesReused: 0 };
    await this.prisma.syncRun.update({
      where: { id: batchRunId },
      data: {
        metadata: {
          import: {
            ...meta,
            summary: {
              variantsImported: prev.variantsImported + delta.variantsImported,
              categoriesCreated: prev.categoriesCreated + delta.categoriesCreated,
              categoriesReused: prev.categoriesReused + delta.categoriesReused,
            },
          },
        } as any,
      },
    });
  }

  /**
   * Second-row result counts for a batch run (frontend contract point
   * 4): category/variant counts from accumulated batch metadata, image
   * counts live from the IMAGES_* run items. Returns zeros (never nulls)
   * when the batch has no summary yet — the result screen renders the
   * counts only when `importSummary` is present on the run detail.
   */
  async importSummary(batchRunId: string, storeId?: string): Promise<ImportSummary> {
    const batch = await this.prisma.syncRun.findUnique({
      where: { id: batchRunId },
      select: { metadata: true, storeId: true },
    });
    if (!batch) throw new BadRequestException(`No run ${batchRunId}.`);
    if (storeId && (batch as any).storeId !== storeId) {
      throw new BadRequestException(`Run ${batchRunId} does not belong to this store.`);
    }
    const meta = (batch.metadata as ImportBatchMetadata | null)?.import;
    const images = await this.imageStatus(batchRunId, storeId);
    return {
      categoriesCreated: meta?.summary?.categoriesCreated ?? 0,
      categoriesReused: meta?.summary?.categoriesReused ?? 0,
      variantsImported: meta?.summary?.variantsImported ?? 0,
      imagesDownloaded: images.downloaded,
      imagesPending: images.pending,
      imagesFailed: images.failedImages,
    };
  }

  async getBatchRun(batchRunId: string) {
    return this.prisma.syncRun.findUnique({ where: { id: batchRunId } });
  }

  /**
   * Processor seam: the importable-store check + provider + secrets for a
   * page job. Throws BadRequestException when the store is no longer
   * importable (the processor turns that into per-item FAILEDs).
   */
  async importContext(storeId: string): Promise<{
    store: { id: string; kind: string; status: string; name?: string };
    provider: CommerceProvider;
    secrets: StoreWithSecrets;
  }> {
    return this.requireImportableStore(storeId);
  }

  // -------------------------------------------------------------------------
  // Skip management (§7.1)
  // -------------------------------------------------------------------------

  /**
   * Skip list in the agreed frontend contract shape:
   * `[{ remoteId, note?, skippedAt?, skippedBy? }]`.
   */
  async listSkips(
    storeId: string,
  ): Promise<Array<{ remoteId: string; note?: string; skippedAt?: Date; skippedBy?: string }>> {
    await this.stores.detail(storeId);
    const rows = await this.prisma.storeProductImportSkip.findMany({
      where: { storeId },
      orderBy: { skippedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      remoteId: r.externalId,
      note: r.note ?? undefined,
      skippedAt: r.skippedAt,
      skippedBy: r.skippedBy ?? undefined,
    }));
  }

  async createSkip(storeId: string, remoteId: string, note: string | undefined, userId?: string) {
    await this.stores.detail(storeId);
    const row = await this.prisma.storeProductImportSkip.upsert({
      where: { storeId_externalId: { storeId, externalId: remoteId } },
      create: { storeId, externalId: remoteId, note: note ?? null, skippedBy: userId ?? null },
      update: { note: note ?? null, skippedBy: userId ?? null, skippedAt: new Date() },
    });
    return {
      remoteId: row.externalId,
      note: row.note ?? undefined,
      skippedAt: row.skippedAt,
      skippedBy: row.skippedBy ?? undefined,
    };
  }

  async deleteSkip(storeId: string, remoteId: string): Promise<{ deleted: number }> {
    await this.stores.detail(storeId);
    const res = await this.prisma.storeProductImportSkip.deleteMany({
      where: { storeId, externalId: remoteId },
    });
    return { deleted: res.count };
  }

  async clearSkips(storeId: string): Promise<{ deleted: number }> {
    await this.stores.detail(storeId);
    const res = await this.prisma.storeProductImportSkip.deleteMany({ where: { storeId } });
    return { deleted: res.count };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async requireImportableStore(storeId: string): Promise<{
    store: { id: string; kind: string; status: string; name?: string };
    provider: CommerceProvider;
    secrets: StoreWithSecrets;
  }> {
    const store = (await this.stores.detail(storeId)) as {
      id: string;
      kind: string;
      status: string;
      name?: string;
    };
    if (store.kind !== 'WOOCOMMERCE') {
      throw new BadRequestException(
        `Product import is WooCommerce-only in v1 (store ${store.id} is ${store.kind}).`,
      );
    }
    if (!IMPORTABLE_STORE_STATUSES.has(store.status)) {
      throw new BadRequestException(
        `Store is ${store.status}; connect it before importing products.`,
      );
    }
    const secrets = await this.stores.storeWithSecrets(storeId);
    const provider = this.registry.providerFor(store);
    return { store, provider, secrets };
  }

  private async snapshotsFor(
    ctx: ImportRunContext,
    remoteBody: Record<string, unknown>,
    remoteId: string,
    fields: FieldKey[],
  ): Promise<Record<FieldKey, FieldSnapshot>> {
    if (fields.length === 0) return {};
    if (typeof ctx.provider.snapshotsFromProductBody === 'function') {
      return ctx.provider.snapshotsFromProductBody(remoteBody as NormalizedProduct, fields);
    }
    return ctx.provider.readProductFields(ctx.secrets, { providerId: remoteId }, fields);
  }

  private adoptBaselines(
    fields: FieldKey[],
    snapshots: Record<FieldKey, FieldSnapshot>,
    ecoFields: Record<string, unknown>,
    provider: CommerceProvider,
  ): Array<{
    field: string;
    ownership: string;
    baselineHash: string;
    externalHash: string;
    ecoMateHashAtRebase: string;
    evidence: string;
  }> {
    const evidence =
      provider.declaredCapabilities.externalEditsDetectable === 'plugin' ? 'PLUGIN' : 'INFERRED';
    const rows: Array<{
      field: string;
      ownership: string;
      baselineHash: string;
      externalHash: string;
      ecoMateHashAtRebase: string;
      evidence: string;
    }> = [];
    for (const field of fields) {
      const snap = snapshots[field];
      if (!snap) continue;
      const ecoHash = hashFieldValue((ecoFields as any)[field]);
      const adopted = this.ownership.adoptExisting({
        externalHash: snap.hash,
        ecoMateHash: ecoHash,
      });
      rows.push({
        field: field as string,
        ownership: adopted.ownership,
        baselineHash: adopted.baselineHash,
        externalHash: adopted.externalHash,
        ecoMateHashAtRebase: adopted.ecoMateHashAtRebase,
        evidence,
      });
    }
    return rows;
  }

  /** R3 category resolution. Returns null only when assign_one's target is gone. */
  /**
   * Category resolution per R3. Returns the ids plus per-call summary
   * counts: `created` = categories created by this call, `reused` =
   * remote categories matched to pre-existing ones. A slug resolved
   * earlier in the same page (cache hit) counts nothing — it was counted
   * at first resolution. assign_one/none count nothing: assign_one reuses
   * one existing category for every product (counting it per item would
   * inflate the stat), and none touches no categories.
   *
   * Approximation (documented): the cache is per page, so a category
   * created on page 1 and matched again on page 2 counts as `reused` on
   * page 2. Single-page imports (≤100 products) are exact.
   */
  private async resolveCategoryIds(
    ctx: ImportRunContext,
    normalized: NormalizedImportProduct,
  ): Promise<{ ids: string[]; created: number; reused: number } | null> {
    const mode = ctx.options.categoryMode;
    if (mode === 'none') return { ids: [], created: 0, reused: 0 };
    if (mode === 'assign_one') {
      if (ctx.cache.assignOneCategoryId === undefined) {
        const cat = await this.prisma.category.findUnique({
          where: { id: ctx.options.categoryId! },
          select: { id: true },
        });
        ctx.cache.assignOneCategoryId = cat?.id ?? null;
      }
      return ctx.cache.assignOneCategoryId
        ? { ids: [ctx.cache.assignOneCategoryId], created: 0, reused: 0 }
        : null;
    }
    // with_categories, flat single-segment (v1): Woo payloads carry only
    // {id, name, slug} per category with no parent info, so full-path
    // matching (E23) needs a category-list provider call that does not
    // exist yet. Match by slug tenant-wide; create top-level when missing.
    const ids: string[] = [];
    let created = 0;
    let reused = 0;
    for (const cat of normalized.categories) {
      const cached = ctx.cache.categories.get(cat.slug);
      if (cached) {
        ids.push(cached);
        continue;
      }
      let row = await this.prisma.category.findFirst({
        where: { slug: cat.slug },
        select: { id: true },
      });
      if (row) {
        reused += 1;
      } else {
        try {
          row = await this.prisma.category.create({
            data: { name: cat.name, slug: cat.slug },
            select: { id: true },
          });
          created += 1;
          ctx.cache.categoriesCreated.add(cat.slug);
        } catch (err) {
          if (this.isUniqueViolation(err)) {
            // Lost a race — someone else created it; from this import's
            // perspective it is reused, not created.
            row = await this.prisma.category.findFirst({
              where: { slug: cat.slug },
              select: { id: true },
            });
            if (row) reused += 1;
          } else {
            throw err;
          }
        }
      }
      if (row) {
        ctx.cache.categories.set(cat.slug, row.id);
        ids.push(row.id);
      }
    }
    return { ids, created, reused };
  }

  private async resolveTagIds(ctx: ImportRunContext, names: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const name of names) {
      const cached = ctx.cache.tags.get(name);
      if (cached) {
        ids.push(cached);
        continue;
      }
      let row = await this.prisma.tag.findFirst({ where: { name }, select: { id: true } });
      if (!row) {
        try {
          row = await this.prisma.tag.create({
            data: { name, slug: slugify(name) },
            select: { id: true },
          });
        } catch (err) {
          if (this.isUniqueViolation(err)) {
            row = await this.prisma.tag.findFirst({ where: { name }, select: { id: true } });
          } else {
            throw err;
          }
        }
      }
      if (row) {
        ctx.cache.tags.set(name, row.id);
        ids.push(row.id);
      }
    }
    return ids;
  }

  private async resolveBrandId(ctx: ImportRunContext, name: string): Promise<string | null> {
    const cached = ctx.cache.brands.get(name);
    if (cached) return cached;
    let row = await this.prisma.brand.findFirst({ where: { name }, select: { id: true } });
    if (!row) {
      const base = slugify(name);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          row = await this.prisma.brand.create({
            data: { name, slug: attempt === 0 ? base : `${base}-${attempt + 1}` },
            select: { id: true },
          });
          break;
        } catch (err) {
          if (!this.isUniqueViolation(err)) throw err;
        }
      }
      if (!row) row = await this.prisma.brand.findFirst({ where: { name }, select: { id: true } });
    }
    if (row) ctx.cache.brands.set(name, row.id);
    return row?.id ?? null;
  }

  private async resolveAttributeId(ctx: ImportRunContext, name: string): Promise<string> {
    const cached = ctx.cache.attributes.get(name);
    if (cached) return cached;
    let row = await this.prisma.attribute.findFirst({ where: { name }, select: { id: true } });
    if (!row) {
      try {
        row = await this.prisma.attribute.create({ data: { name }, select: { id: true } });
      } catch (err) {
        if (this.isUniqueViolation(err)) {
          row = await this.prisma.attribute.findFirst({ where: { name }, select: { id: true } });
        } else {
          throw err;
        }
      }
    }
    const id = row!.id;
    ctx.cache.attributes.set(name, id);
    return id;
  }

  private async resolveAttributeValueId(
    ctx: ImportRunContext,
    attributeId: string,
    value: string,
  ): Promise<string> {
    const key = `${attributeId}:${value}`;
    const cached = ctx.cache.attributeValues.get(key);
    if (cached) return cached;
    // AttributeValue has NO unique (migration item 5 deferred) — find-first
    // + in-memory cache; a cross-import race can leave display-identical
    // duplicates, which are harmless.
    let row = await this.prisma.attributeValue.findFirst({
      where: { attributeId, value },
      select: { id: true },
    });
    if (!row) {
      row = await this.prisma.attributeValue.create({
        data: { attributeId, value },
        select: { id: true },
      });
    }
    ctx.cache.attributeValues.set(key, row.id);
    return row.id;
  }

  private async ensureUniqueSlug(base: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const taken = await this.prisma.product.findFirst({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

  private async recordItem(
    ctx: ImportRunContext,
    item: { productId?: string; externalObjectId?: string; status: string; reason: string },
  ): Promise<void> {
    await this.runs.recordItem(ctx.childRunId, {
      storeId: ctx.storeId,
      productId: item.productId,
      objectType: 'PRODUCT',
      externalObjectId: item.externalObjectId,
      status: item.status,
      reason: item.reason,
    });
  }

  private async fail(
    ctx: ImportRunContext,
    remoteId: string,
    reason: string,
    message: string,
    productId?: string,
  ): Promise<ImportOutcome> {
    await this.recordItem(ctx, { productId, externalObjectId: remoteId, status: 'FAILED', reason });
    this.logger.warn(`import ${remoteId} failed ${reason}: ${message}`);
    return { status: 'failed', reason, remoteId, productId, imageJobEnqueued: false };
  }

  private isRemoteNotFound(err: unknown): boolean {
    return (
      err instanceof ProviderError && err.category === ProviderErrorCategory.REMOTE_NOT_FOUND
    );
  }

  private isUniqueViolation(err: unknown): boolean {
    return (err as any)?.code === 'P2002';
  }

  private targetIncludes(err: unknown, field: string): boolean {
    const target = (err as any)?.meta?.target;
    return Array.isArray(target) && target.includes(field);
  }
}
