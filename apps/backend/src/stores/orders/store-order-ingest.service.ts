/**
 * Store order ingest worker — central-commerce P6 (§8.5, BR-11/BR-12/BR-13/
 * BR-16/BR-17).
 *
 * Both funnels (webhook fast path, hourly reconcile safety net) resolve to
 * the SAME job identity (`store:{storeId}:order:{externalId}`) so the two
 * paths cannot double-work (BR-11/BR-12). Identity is DB-enforced:
 * `StoreOrderMapping @@unique([storeId, externalOrderId])` +
 * `Order.idempotencyKey @unique`.
 *
 * Ingest worker steps (§8.5): (1) mapping lookup → status-only reconcile
 * (totals/items never rewritten, ignored deltas noted); (2) normalizeOrder();
 * (3) SKU resolution via StoreSkuMapping → variant SKU → product SKU →
 * product-less + UNMATCHED_SKU issue + one-click map action; (4) external
 * status → internal status via StoreOrderStatusMap (seeded from the
 * store-effective STORE_STATUS_MAP); (5) ordersService.create(dto, undefined,
 * undefined, undefined, internal); (6) mapping + provenance + ingestFlags
 * + SyncRunItem.
 *
 * BR-13 absolute: no blockedPolicy / reject switch exists anywhere in this
 * file — blocking is evaluated read-only inside create() for flagging only.
 * BR-16: allowStockShortfall — shortfalls flagged, never thrown. BR-17:
 * after ingest only status + storeMetadata are mutable from the store side.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { SyncRunService } from '../sync/sync-run.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { StoresService } from '../stores.service';
import { STATUS_MAP } from '../../import/order-import.service';
import { findOrderTransitionPath } from '../../orders/order-transitions';
import { normalizePhone } from '../../common/utils/phone-utils';
import {
  normalizeOrder,
  buildStoreOrderIdentity,
  type NormalizedIngestOrder,
} from './normalize-order';
import { isOrderDeleteTopic, shouldImportWooEvent } from './webhook-status-gate';

export type IngestTrigger = 'WEBHOOK' | 'RECONCILE' | 'MANUAL';

/**
 * Per-call ingest options. `topic` + `provider` drive the G-15 status
 * gate (create-vs-update matters for missed creation; the gate is
 * Woo-only); `skuContext` carries a shared J-10 batch resolution.
 * All three are optional — callers that omit them get today's behavior
 * (gate fails open to import; SKUs resolve per item).
 *
 * `bypassStatusGate` is the RECONCILE-ONLY carve-out (coordinator
 * decision, fix-round-1): reconcile exists to recover missed real orders,
 * so a `completed` order missed during a webhook outage must NOT be
 * skipped as unimportable. ONLY `StoreOrderReconcileService` sets it;
 * webhook intake/ingest (and the ingest processor) never set it and keep
 * the gate. It bypasses ONLY the G-15 status gate — the P13 zero-stock
 * reject, idempotency, and reconcileStatus are untouched.
 */
export interface IngestOptions {
  type: IngestTrigger;
  runId?: string;
  actor?: string;
  /** Webhook topic, e.g. `order.created`. Absent for reconcile/manual. */
  topic?: string;
  /** Provider slug (`woocommerce` | `shopify` | `custom`). */
  provider?: string;
  /** Shared J-10 batch SKU context (one reconcile page / burst). */
  skuContext?: SkuResolutionContext;
  /** Reconcile-only: skip the G-15 status gate (recover missed orders). */
  bypassStatusGate?: boolean;
}

export interface IngestResult {
  orderId: string;
  created: boolean;
  status: string;
  /** True when this call changed the order status (create or transition). */
  statusChanged: boolean;
  /** True when the G-15 status gate skipped a never-seen order (no order exists; `orderId` is ''). */
  skipped?: boolean;
  /** Gate reason when `skipped` (e.g. `trash-status=cancelled`). */
  skipReason?: string;
}

/** One pre-resolved SKU → local ids (J-10 batch context). */
export interface SkuResolution {
  productId?: string;
  variantId?: string;
  resolved: boolean;
}

/**
 * Shared batch SKU maps for a burst of orders (J-10): built once per
 * reconcile page (or burst) by `buildSkuResolutionContext`, passed into
 * each per-order `ingest()` via `IngestOptions.skuContext`. A SKU present
 * in the map is authoritative for the burst (including `resolved: false`
 * — the batch queries already proved no match exists); a SKU absent from
 * the map falls back to the per-SKU DB path, so behavior is identical
 * for out-of-batch SKUs. Staleness window: a mapping created mid-page
 * is picked up by the next page/run, never the current one.
 */
export interface SkuResolutionContext {
  resolutions: Map<string, SkuResolution>;
}

/**
 * P13 ZERO-STOCK REJECT — OPERATOR-DIRECTED DEVIATION from BR-13/BR-16.
 *
 * The plan's BR-13 ("never reject an external order") and BR-16
 * ("shortfall-flag, never discard") are EXPLICITLY SUPERSEDED for one
 * narrow case by operator direction (see
 * docs/central-commerce/P13-ERP-STOCK-PROJECTION.md, "Deviation note"):
 * when the ERP authoritative stock is ZERO (<= 0) for an ordered item, the
 * external order is REJECTED — not created — with this explicit reason code
 * plus a `ZERO_STOCK_REJECT` issue row. Rationale: ERP is the stock truth
 * and there is nothing to sell; creating the order would manufacture a
 * certain shortfall.
 *
 * Scope is deliberately narrow:
 * - per-ITEM: only items whose ERP stock is zero trigger the reject;
 * - insufficient-but-NONZERO stock keeps the BR-16 shortfall-flag behavior
 *   (flagged, never rejected) — untouched in `OrdersService.create()`;
 * - product-less (unmatched-SKU) items cannot resolve ERP stock and are
 *   never reject triggers — they keep the UNMATCHED_SKU path;
 * - native storefront/admin validation is UNCHANGED (still throws via
 *   `assertManagedAvailability` as before).
 */
export const ZERO_STOCK_REJECT = 'ZERO_STOCK_REJECT';

/**
 * Store-layer status overrides (Boss decision 2026-11-23, Woo-only): a Woo
 * refund/return is a CANCEL, never a Return. The CSV importer's STATUS_MAP
 * keeps `refunded → Returned` for CSV rows — that constant is SHARED with
 * the CSV importer and must NOT change — so the store layer overrides it
 * here. `returned` (literal string, custom-status Woo installs) is unmapped
 * in STATUS_MAP and maps here too.
 *
 * Consulted by resolveStatusName BEFORE the STATUS_MAP fallback, and the
 * seed source for ensureStatusMaps — so a seeded row can never re-introduce
 * the old mapping. Per-store DB rows still win (operator edits).
 */
export const STORE_STATUS_OVERRIDES: Record<string, string> = {
  refunded: 'Cancelled',
  returned: 'Cancelled',
};

/** Effective external→internal map for store ingest: STATUS_MAP + overrides. */
export const STORE_STATUS_MAP: Record<string, string> = {
  ...STATUS_MAP,
  ...STORE_STATUS_OVERRIDES,
};

/** ERP authoritative stock for one ordered item (null = unresolvable). */
export interface ErpStockLevel {
  qty: number;
  mode: string | null;
}

@Injectable()
export class StoreOrderIngestService {
  private readonly logger = new Logger(StoreOrderIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Lazily resolved: StoresModule cannot statically import OrdersModule
    // (Stock/Inventory → Stores cycle). Injected directly in tests; in
    // production resolved from the container via ModuleRef on first use.
    @Optional() private readonly ordersServiceOrNull: OrdersService | null,
    private readonly runs: SyncRunService,
    private readonly registry: ProviderRegistryService,
    private readonly stores: StoresService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private ordersSvc(): OrdersService {
    if (this.ordersServiceOrNull) return this.ordersServiceOrNull;
    if (!this.moduleRef) {
      throw new Error('OrdersService unavailable (no direct instance, no ModuleRef)');
    }
    return this.moduleRef.get(OrdersService, { strict: false });
  }

  /**
   * Seed per-store status rows from the store-effective STORE_STATUS_MAP
   * (STATUS_MAP + the Woo refund/return → Cancelled overrides, §8.5 step 4).
   * Existing rows are never overwritten — operator edits win.
   */
  async ensureStatusMaps(storeId: string): Promise<number> {
    let seeded = 0;
    for (const [externalStatus, internalStatusName] of Object.entries(STORE_STATUS_MAP)) {
      const existing = await this.prisma.storeOrderStatusMap.findUnique({
        where: { storeId_externalStatus: { storeId, externalStatus } },
      });
      if (existing) continue;
      await this.prisma.storeOrderStatusMap.create({
        data: { storeId, externalStatus, internalStatusName },
      });
      seeded += 1;
    }
    return seeded;
  }

  /** External status → internal OrderStatus name (store map, then seed fallback). */
  async resolveStatusName(storeId: string, externalStatus: string): Promise<string | null> {
    const row = await this.prisma.storeOrderStatusMap.findUnique({
      where: { storeId_externalStatus: { storeId, externalStatus } },
    });
    if (row) return row.internalStatusName;
    const lower = (externalStatus ?? '').toLowerCase();
    if (STORE_STATUS_MAP[lower]) return STORE_STATUS_MAP[lower];
    return null;
  }

  /**
   * Resolve one normalized item to local ids. Precedence: StoreSkuMapping →
   * ProductVariant.sku (unique) → Product.sku (first match). Unresolved →
   * product-less (nulls) — the caller raises UNMATCHED_SKU.
   *
   * J-10: when a batch context is supplied and contains the SKU, the
   * pre-resolved answer is returned with zero queries; a SKU absent from
   * the context falls back to the per-SKU DB path below (identical
   * behavior for out-of-batch SKUs).
   */
  async resolveSku(
    storeId: string,
    sku: string,
    ctx?: SkuResolutionContext,
  ): Promise<{ productId?: string; variantId?: string; resolved: boolean }> {
    if (!sku) return { resolved: false };
    const batched = ctx?.resolutions.get(sku);
    if (batched) return batched;
    const mapped = await this.prisma.storeSkuMapping.findUnique({
      where: { storeId_sku: { storeId, sku } },
    });
    if (mapped && (mapped.productId || mapped.variantId)) {
      return {
        productId: mapped.productId ?? undefined,
        variantId: mapped.variantId ?? undefined,
        resolved: true,
      };
    }
    // SaaS: ProductVariant.sku is NOT unique in the tenant schema (only
    // @@index([tenantId, productId])) — findUnique would throw a Prisma
    // validation error, so this is findFirst (first match wins; the
    // explicit StoreSkuMapping above is the deterministic path).
    const variant = await this.prisma.productVariant.findFirst({
      where: { sku },
      select: { id: true, productId: true },
    });
    if (variant) {
      return { productId: variant.productId, variantId: variant.id, resolved: true };
    }
    const product = await this.prisma.product.findFirst({
      where: { sku },
      select: { id: true },
    });
    if (product) return { productId: product.id, resolved: true };
    return { resolved: false };
  }

  /**
   * J-10 batch SKU resolution: resolve MANY SKUs with exactly 3 batched
   * queries (StoreSkuMapping → ProductVariant → Product, same precedence
   * as `resolveSku`) instead of up to 3 queries per SKU. A 50-order page
   * with 2 items each drops from ≤300 lookups to 3. First-match
   * semantics match `findFirst` (first row per SKU in returned order —
   * the same order `findFirst` sees, so no behavior change).
   */
  async buildSkuResolutionContext(storeId: string, skus: string[]): Promise<SkuResolutionContext> {
    const resolutions = new Map<string, SkuResolution>();
    const unique = [...new Set((skus ?? []).filter(Boolean))];
    if (unique.length === 0) return { resolutions };
    const mappings = (await this.prisma.storeSkuMapping.findMany({
      where: { storeId, sku: { in: unique } },
    })) as any[];
    const mappingBySku = new Map<string, any>();
    for (const m of mappings) if (!mappingBySku.has(m.sku)) mappingBySku.set(m.sku, m);
    const variants = (await this.prisma.productVariant.findMany({
      where: { sku: { in: unique } },
      select: { id: true, productId: true, sku: true },
    })) as any[];
    const variantBySku = new Map<string, any>();
    for (const v of variants) if (!variantBySku.has(v.sku)) variantBySku.set(v.sku, v);
    const products = (await this.prisma.product.findMany({
      where: { sku: { in: unique } },
      select: { id: true, sku: true },
    })) as any[];
    const productBySku = new Map<string, any>();
    for (const p of products) if (!productBySku.has(p.sku)) productBySku.set(p.sku, p);
    for (const sku of unique) {
      const mapped = mappingBySku.get(sku);
      if (mapped && (mapped.productId || mapped.variantId)) {
        resolutions.set(sku, {
          productId: mapped.productId ?? undefined,
          variantId: mapped.variantId ?? undefined,
          resolved: true,
        });
        continue;
      }
      const variant = variantBySku.get(sku);
      if (variant) {
        resolutions.set(sku, { productId: variant.productId, variantId: variant.id, resolved: true });
        continue;
      }
      const product = productBySku.get(sku);
      if (product) {
        resolutions.set(sku, { productId: product.id, resolved: true });
        continue;
      }
      resolutions.set(sku, { resolved: false });
    }
    return { resolutions };
  }

  /**
   * Resolve the ERP authoritative stock for one ordered item — the SAME
   * truth the P13 projection pushes (INVENTORY_CONTROLLED → physical
   * available sum, else managed-stock available). Returns null when the
   * row(s) cannot be resolved (caller must NOT reject on unknown).
   */
  async erpStockForItem(
    productId: string | undefined,
    variantId: string | undefined,
  ): Promise<ErpStockLevel | null> {
    if (!productId && !variantId) return null;
    const product = productId
      ? await this.prisma.product.findUnique({
          where: { id: productId },
          select: {
            id: true,
            availabilityMode: true,
            managedStockQuantity: true,
            reservedStock: true,
          },
        })
      : null;
    // A variant-only reference resolves its parent for the mode.
    let mode: string | null = (product as any)?.availabilityMode ?? null;
    if (!product && variantId) {
      const parent = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: {
          productId: true,
          product: {
            select: { availabilityMode: true, managedStockQuantity: true, reservedStock: true },
          },
        },
      }).catch(() => null) as any;
      if (!parent) return null;
      mode = parent?.product?.availabilityMode ?? null;
      if (mode === 'INVENTORY_CONTROLLED') {
        const rows = await this.prisma.physicalInventory.findMany({
          where: { productId: parent.productId, variantId },
          select: { quantity: true, reservedQuantity: true },
        }).catch(() => null);
        if (!rows) return null;
        const qty = rows.reduce((s: number, r: any) => s + ((r.quantity ?? 0) - (r.reservedQuantity ?? 0)), 0);
        return { qty, mode };
      }
      const v = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { managedStockQuantity: true, reservedStock: true },
      }).catch(() => null) as any;
      if (!v) return null;
      return { qty: (v.managedStockQuantity ?? 0) - (v.reservedStock ?? 0), mode };
    }
    if (!product) return null;
    if (mode === 'ALWAYS_IN_STOCK') return { qty: Number.POSITIVE_INFINITY, mode };
    if (mode === 'ALWAYS_OUT_OF_STOCK') return { qty: 0, mode };
    if (mode === 'INVENTORY_CONTROLLED') {
      const rows = await this.prisma.physicalInventory.findMany({
        where: { productId: (product as any).id, variantId: variantId ?? null },
        select: { quantity: true, reservedQuantity: true },
      }).catch(() => null);
      if (!rows) return null;
      const qty = rows.reduce((s: number, r: any) => s + ((r.quantity ?? 0) - (r.reservedQuantity ?? 0)), 0);
      return { qty, mode };
    }
    // MANAGED_STOCK and any other mode (fail-closed to managed fields —
    // same rule as the projection's desiredState).
    if (variantId) {
      const v = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { managedStockQuantity: true, reservedStock: true },
      }).catch(() => null) as any;
      if (!v) return null;
      return { qty: (v.managedStockQuantity ?? 0) - (v.reservedStock ?? 0), mode };
    }
    return {
      qty: ((product as any).managedStockQuantity ?? 0) - ((product as any).reservedStock ?? 0),
      mode,
    };
  }

  /**
   * One-click map action for an UNMATCHED_SKU issue: records the operator's
   * chosen target so the NEXT order with this SKU resolves. Never rewrites
   * already-ingested items (BR-17).
   */
  async mapSku(
    storeId: string,
    sku: string,
    target: { productId?: string; variantId?: string },
  ): Promise<unknown> {
    if (!sku) throw new Error('sku is required');
    if (!target.productId && !target.variantId) {
      throw new Error('productId or variantId is required');
    }
    const row = await this.prisma.storeSkuMapping.upsert({
      where: { storeId_sku: { storeId, sku } },
      create: {
        storeId,
        sku,
        productId: target.productId ?? null,
        variantId: target.variantId ?? null,
        lastVerifiedAt: new Date(),
      },
      update: {
        productId: target.productId ?? null,
        variantId: target.variantId ?? null,
        lastVerifiedAt: new Date(),
      },
    });
    await this.runs.upsertIssue({
      storeId,
      code: 'UNMATCHED_SKU',
      objectType: 'ORDER',
      objectKey: `store:${storeId}:sku:${sku}`,
      message: `SKU "${sku}" mapped by operator — future orders resolve; past items unchanged (BR-17).`,
    });
    return row;
  }

  /**
   * Ingest one raw provider order. Idempotent: webhook + reconcile + manual
   * retry of the same external order yield exactly one EcoMate order.
   */
  async ingest(
    storeId: string,
    rawOrder: Record<string, unknown>,
    trigger: IngestOptions,
  ): Promise<IngestResult> {
    const normalized = normalizeOrder(rawOrder);
    const { idempotencyKey, objectKey } = buildStoreOrderIdentity(storeId, normalized.externalId);

    // G-15: a delete/trashed event carries the order's pre-delete status
    // (or none — normalizeOrder then defaults to `pending`). Force the
    // trash status so the existing-order path below reconciles to
    // Cancelled instead of wrongly landing on Pending. The missing-order
    // path skips delete events outright, so this only affects reconciles.
    if (isOrderDeleteTopic(trigger.topic)) {
      normalized.externalStatus = 'trash';
    }

    // (1) Mapping lookup — existing order → status-only reconcile (BR-17:
    // totals/items never rewritten; ignored deltas recorded as a note).
    const existing = await this.prisma.storeOrderMapping.findUnique({
      where: { storeId_externalOrderId: { storeId, externalOrderId: normalized.externalId } },
      include: { order: { include: { status: true } } },
    });
    if (existing) {
      return this.reconcileStatus(storeId, existing as any, normalized, trigger);
    }

    // G-15 status gate (J-08, keeping reconcile): new orders only — the
    // existing path above already reconciled. A skip records a SKIPPED
    // run item (visible in Sync Center) and returns without creating
    // anything; it is NOT an error (no throw, no retry). The gate is
    // Woo-only and fails open when provider/topic are unknown.
    //
    // RECONCILE CARVE-OUT: when `bypassStatusGate` is set (ONLY
    // StoreOrderReconcileService sets it), the gate is skipped — reconcile
    // recovers missed real orders, so a `completed` order missed during an
    // outage imports instead of being skipped as unimportable. Webhook
    // intake/ingest never set the flag and keep the gate.
    if (trigger.bypassStatusGate) {
      this.logger.log(
        `ingest status gate bypassed ${objectKey} (reconcile carve-out; status ${normalized.externalStatus})`,
      );
    }
    const decision = trigger.bypassStatusGate
      ? { action: 'import' as const, reason: 'reconcile-bypass' }
      : shouldImportWooEvent({
          topic: trigger.topic,
          externalStatus: normalized.externalStatus,
          orderExists: false,
          provider: trigger.provider,
        });
    if (decision.action === 'skip') {
      this.logger.log(
        `ingest skipped ${objectKey} (${decision.reason}; topic ${trigger.topic ?? 'none'}, status ${normalized.externalStatus})`,
      );
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SKIPPED',
          reason: `STATUS_GATE_SKIP: ${decision.reason} (topic ${trigger.topic ?? 'none'}, status ${normalized.externalStatus})`,
          auditLevel: 'G',
        });
      }
      return {
        orderId: '',
        created: false,
        status: normalized.externalStatus,
        statusChanged: false,
        skipped: true,
        skipReason: decision.reason,
      };
    }

    // P2002 race net (BR-12): two funnels racing past the lookup collide on
    // the idempotency UNIQUE — the loser reconciles instead of erroring.
    try {
      return await this.createIngested(storeId, normalized, idempotencyKey, objectKey, trigger);
    } catch (err: any) {
      const isConflict =
        err?.code === 'P2002' ||
        /unique|idempotency|already exists/i.test(err?.message ?? '');
      if (!isConflict) throw err;
      const raced = await this.prisma.storeOrderMapping.findUnique({
        where: { storeId_externalOrderId: { storeId, externalOrderId: normalized.externalId } },
        include: { order: { include: { status: true } } },
      });
      if (!raced) throw err;
      this.logger.warn(`ingest race on ${objectKey} — reconciling existing order`);
      return this.reconcileStatus(storeId, raced as any, normalized, trigger);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private async createIngested(
    storeId: string,
    normalized: NormalizedIngestOrder,
    idempotencyKey: string,
    objectKey: string,
    trigger: IngestOptions,
  ): Promise<IngestResult> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    const storeKind = (store as any)?.kind ?? 'CUSTOM';
    const storeName = (store as any)?.name ?? storeId;

    const statusName = await this.resolveStatusName(storeId, normalized.externalStatus);
    let initialStatusName: string | undefined;
    if (statusName) {
      const statusRow = await this.prisma.orderStatus.findFirst({ where: { name: statusName } });
      if (statusRow) initialStatusName = statusName;
    }

    // (3) SKU resolution per item.
    const unmatchedSkus: string[] = [];
    const items: Array<{
      productId?: string;
      variantId?: string;
      quantity: number;
      price: number;
    }> = [];
    for (const li of normalized.items) {
      const hit = await this.resolveSku(storeId, li.sku, trigger.skuContext);
      if (!hit.resolved) {
        if (li.sku) unmatchedSkus.push(li.sku);
        items.push({ quantity: li.quantity, price: li.price });
        continue;
      }
      items.push({
        productId: hit.productId,
        variantId: hit.variantId,
        quantity: li.quantity,
        price: li.price,
      });
    }
    // P13 ZERO_STOCK_REJECT (operator-directed deviation from BR-13/BR-16 —
    // see ZERO_STOCK_REJECT above): per resolved item, when the ERP
    // authoritative stock is zero the order is NOT created. Product-less
    // (unmatched-SKU) items are unresolvable and never trigger; nonzero
    // shortfalls flow on to create() and keep the BR-16 flag behavior.
    const zeroSkus: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as { productId?: string; variantId?: string };
      if (!it.productId && !it.variantId) continue;
      const erp = await this.erpStockForItem(it.productId, it.variantId);
      if (erp && erp.qty <= 0) {
        zeroSkus.push(normalized.items[i]?.sku || it.variantId || it.productId || `line ${i + 1}`);
      }
    }
    if (zeroSkus.length > 0) {
      const reason =
        `${ZERO_STOCK_REJECT}: external order ${normalized.externalId} not created — ` +
        `ERP authoritative stock is zero for: ${zeroSkus.join(', ')}. ` +
        `Restock in EcoMate and re-ingest (deviation from BR-13/BR-16 per P13).`;
      await this.runs.upsertIssue({
        storeId,
        code: ZERO_STOCK_REJECT,
        objectType: 'ORDER',
        objectKey,
        message: reason,
      });
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'FAILED',
          reason,
          auditLevel: 'G',
        });
      }
      // Permanent (not retryable-by-design): a retry re-resolves the same
      // zero stock and re-rejects identically — no order is ever created, no
      // mapping row is written, and the issue row is upserted (one compact
      // row, never N). The reconcile/processor catch-chain records FAILED.
      throw new Error(reason);
    }
    // An external order with zero parseable lines still ingests (BR-13/BR-16
    // spirit: never lose it) — one product-less placeholder keeps the totals.
    const createItems =
      items.length > 0
        ? items
        : [{ quantity: 1, price: normalized.externalTotal }];

    // BD-only checkout validation must not reject foreign numbers (BR-13):
    // pass the phone only when it normalizes, else keep it in metadata.
    const normalizedPhone = normalized.customerPhone
      ? normalizePhone(normalized.customerPhone)
      : null;

    // NOTE: create(dto, clientIp, user, userAgent, internal) — internal is
    // the FIFTH positional arg (userAgent is 4th on main). Passing internal
    // fourth lands in `userAgent` and silently disables the entire
    // external-ingest contract (live-E2E find: product-less throw +
    // native block throw on ingested orders).
    const order = await this.ordersSvc().create(
      {
        items: createItems as any,
        guestName: normalized.customerName ?? undefined,
        guestPhone: normalizedPhone ?? undefined,
        guestEmail: normalized.customerEmail ?? undefined,
        // Shipping/contact detail rides the order (name/phone/email double
        // as fallback contacts when PII-approved reads provide them).
        shippingAddress: (normalized.shippingAddress ?? {}) as any,
        customerNotes:
          normalizedPhone || !normalized.customerPhone
            ? undefined
            : `External customer phone (un-normalized): ${normalized.customerPhone}`,
        sourcePlatform: 'EXTERNAL_STORE',
        sourceType: `EXTERNAL_STORE:${storeKind}`,
        sourceEntity: storeName,
      } as any,
      undefined,
      undefined,
      undefined,
      {
        ingest: 'external_store',
        storeId,
        externalOrderId: normalized.externalId,
        initialStatusName,
        idempotencyKey,
        allowStockShortfall: true,
        skipPurchaseTracking: true,
        allowProductlessItems: true,
        storeMetadata: {
          externalStatus: normalized.externalStatus,
          currency: normalized.currency,
          externalTotal: normalized.externalTotal,
          externalCreatedAt: normalized.externalCreatedAt?.toISOString() ?? null,
          externalUpdatedAt: normalized.externalUpdatedAt?.toISOString() ?? null,
          rawPhone: normalized.customerPhone,
          itemCount: normalized.items.length,
          unmatchedSkus,
        },
      },
    );

    // (6) Mapping + issues + run item.
    await this.prisma.storeOrderMapping.create({
      data: {
        storeId,
        externalOrderId: normalized.externalId,
        orderId: (order as any).id,
        lastExternalStatus: normalized.externalStatus,
        externalUpdatedAt: normalized.externalUpdatedAt,
      },
    });

    for (const sku of new Set(unmatchedSkus)) {
      await this.runs.upsertIssue({
        storeId,
        code: 'UNMATCHED_SKU',
        objectType: 'ORDER',
        objectKey: `${objectKey}:sku:${sku}`,
        message: `SKU "${sku}" on external order ${normalized.externalId} matched no local product — item created product-less. Map it to resolve future orders (past items unchanged, BR-17).`,
      });
    }
    if (trigger.runId) {
      await this.runs.recordItem(trigger.runId, {
        storeId,
        objectType: 'ORDER',
        externalObjectId: normalized.externalId,
        status: 'SUCCESS',
        reason: `INGESTED via ${trigger.type} (idempotency ${idempotencyKey})`,
        auditLevel: 'G',
      });
    }
    return { orderId: (order as any).id, created: true, status: (order as any)?.status?.name ?? initialStatusName ?? 'Pending', statusChanged: true };
  }

  private async reconcileStatus(
    storeId: string,
    mapping: {
      orderId: string;
      externalOrderId: string;
      order: { status: { name: string }; total: unknown };
    },
    normalized: NormalizedIngestOrder,
    trigger: IngestOptions,
  ): Promise<IngestResult> {
    const currentName = mapping.order?.status?.name;
    const targetName = await this.resolveStatusName(storeId, normalized.externalStatus);

    // Totals/items are NEVER rewritten (BR-17) — a delta is only noted.
    const deltaNote =
      targetName && Number(normalized.externalTotal) !== Number((mapping.order as any)?.total)
        ? ` external total ${normalized.externalTotal} differs from ingested ${(mapping.order as any)?.total} — kept ingested values (BR-17).`
        : '';

    await this.prisma.storeOrderMapping.update({
      where: { storeId_externalOrderId: { storeId, externalOrderId: normalized.externalId } },
      data: {
        lastExternalStatus: normalized.externalStatus,
        externalUpdatedAt: normalized.externalUpdatedAt,
      },
    });

    if (!targetName) {
      // Unmapped external status (draft / custom slug): there is nothing to
      // move to. Say so — the old code reported this as `already "X"`,
      // which lied about the cause.
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SKIPPED',
          reason: `STATUS_ONLY_RECONCILE: unmapped external status "${normalized.externalStatus}" — kept "${currentName}"; totals/items untouched (BR-17).${deltaNote}`,
          auditLevel: 'G',
        });
      }
      if (deltaNote) await this.appendTimelineNote(mapping.orderId, currentName, `Reconcile note:${deltaNote}`);
      return { orderId: mapping.orderId, created: false, status: currentName, statusChanged: false };
    }

    if (targetName === currentName) {
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SKIPPED',
          reason: `STATUS_ONLY_RECONCILE: already "${currentName}"; totals/items untouched (BR-17).${deltaNote}`,
          auditLevel: 'G',
        });
      }
      if (deltaNote) await this.appendTimelineNote(mapping.orderId, currentName, `Reconcile note:${deltaNote}`);
      return { orderId: mapping.orderId, created: false, status: currentName, statusChanged: false };
    }

    const target = await this.prisma.orderStatus.findFirst({ where: { name: targetName } });
    if (!target) {
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SKIPPED',
          reason: `STATUS_ONLY_RECONCILE: unknown internal status "${targetName}" — kept "${currentName}".${deltaNote}`,
          auditLevel: 'G',
        });
      }
      return { orderId: mapping.orderId, created: false, status: currentName, statusChanged: false };
    }

    const actor = trigger.actor ?? (trigger.type === 'WEBHOOK' ? 'webhook' : 'reconcile');
    try {
      await this.ordersSvc().updateStatus(
        mapping.orderId,
        { statusId: (target as any).id } as any,
        actor,
        'store-sync',
      );
      if (deltaNote) await this.appendTimelineNote(mapping.orderId, targetName, `Reconcile note:${deltaNote}`);
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SUCCESS',
          reason: `STATUS_ONLY_RECONCILE: "${currentName}" → "${targetName}" via ${trigger.type}.${deltaNote}`,
          auditLevel: 'G',
        });
      }
      return { orderId: mapping.orderId, created: false, status: targetName, statusChanged: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Direct step failed (usually the transition guard): try a forward
      // walk through legal transitions (e.g. Packed → Shipping → Delivered
      // when Woo completed an order EcoMate still has Packed). Same pattern
      // as courier sync's advanceOrderStatusFromSync; driven by the
      // authoritative ORDER_TRANSITIONS, not the dispatch SYNC_ copy.
      const walked = await this.walkStatusForward(mapping.orderId, currentName, targetName, actor, target as any);
      if (walked.ok) {
        if (deltaNote) await this.appendTimelineNote(mapping.orderId, targetName, `Reconcile note:${deltaNote}`);
        if (trigger.runId) {
          await this.runs.recordItem(trigger.runId, {
            storeId,
            objectType: 'ORDER',
            externalObjectId: normalized.externalId,
            status: 'SUCCESS',
            reason: `STATUS_ONLY_RECONCILE: "${currentName}" → "${targetName}" via ${trigger.type} (walked ${[currentName, ...walked.path].join(' → ')}).${deltaNote}`,
            auditLevel: 'G',
          });
        }
        return { orderId: mapping.orderId, created: false, status: targetName, statusChanged: true };
      }
      // Fail closed as before (SKIPPED + issue, no throw) — but say where a
      // partial walk stopped, so the run item never claims the order is
      // still at the old status when it actually advanced a hop.
      const walkedNote = walked.reached !== currentName ? ` (walked to "${walked.reached}" before failing)` : '';
      await this.runs.upsertIssue({
        storeId,
        code: 'ORDER_STATUS_RECONCILE_FAILED',
        objectType: 'ORDER',
        objectKey: `store:${storeId}:order:${normalized.externalId}`,
        message: `Status reconcile "${currentName}" → "${targetName}" failed: ${msg}${walkedNote}`,
      });
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SKIPPED',
          reason: `STATUS_ONLY_RECONCILE failed ("${currentName}" → "${targetName}"): ${msg}${walkedNote}`,
          auditLevel: 'G',
        });
      }
      return { orderId: mapping.orderId, created: false, status: walked.reached, statusChanged: walked.reached !== currentName };
    }
  }

  /**
   * Forward multi-step walk (store-sync counterpart of courier sync's
   * advanceOrderStatusFromSync): BFS a path through ORDER_TRANSITIONS and
   * step it one updateStatus per hop, stopping at the first failed hop.
   * Each hop runs the full updateStatus side effects for its target.
   *
   * Safety rules (same as the dispatch path):
   * - No walk when the path is one hop — the direct attempt already failed,
   *   retrying the identical call is pointless.
   * - Never step THROUGH Delivered or Cancelled as an intermediate: a
   *   returned parcel must never be briefly marked delivered (Delivered
   *   side effects), and a cancel-then-revive walk is not a transition.
   * - Never walk TOWARD Cancelled: the only multi-hop Cancelled path runs
   *   through Shipping (Packed → Shipping → Cancelled), and cancelling
   *   must never advance fulfilment. Cancel stays direct-or-not-at-all.
   */
  private async walkStatusForward(
    orderId: string,
    fromName: string,
    targetName: string,
    actor: string,
    target: { id: string },
  ): Promise<{ ok: boolean; path: string[]; reached: string }> {
    const path = findOrderTransitionPath(fromName, targetName);
    if (path.length < 2) return { ok: false, path, reached: fromName };
    if (targetName === 'Cancelled') return { ok: false, path, reached: fromName };
    const intermediates = path.slice(0, -1);
    if (intermediates.includes('Delivered') || intermediates.includes('Cancelled')) {
      return { ok: false, path, reached: fromName };
    }
    let reached = fromName;
    for (const step of path) {
      const stepStatus =
        step === targetName
          ? target
          : await this.prisma.orderStatus.findFirst({ where: { name: step } });
      if (!stepStatus) return { ok: false, path, reached };
      try {
        await this.ordersSvc().updateStatus(
          orderId,
          { statusId: (stepStatus as any).id } as any,
          actor,
          'store-sync',
        );
        reached = step;
      } catch (e) {
        this.logger.warn(
          `Status walk ${fromName} → ${targetName} stopped at "${reached}" (step "${step}" failed): ${(e as Error).message}`,
        );
        return { ok: false, path, reached };
      }
    }
    return { ok: true, path, reached: targetName };
  }

  private async appendTimelineNote(orderId: string, statusName: string, note: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { timeline: true },
    });
    const timeline = Array.isArray((order as any)?.timeline)
      ? [...(order as any).timeline]
      : [];
    timeline.push({ status: statusName, timestamp: new Date().toISOString(), note });
    await this.prisma.order.update({
      where: { id: orderId },
      data: { timeline: timeline as any },
    });
  }

  /** Provider handle for fetchOrders — NATIVE throws (BR-20). */
  async providerFor(storeId: string) {
    const store = await this.stores.storeWithSecrets(storeId);
    return this.registry.providerFor({ kind: (store as any).kind });
  }
}
