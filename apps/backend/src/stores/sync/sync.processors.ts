/**
 * In-process sync processors — central-commerce §8.1 (P4).
 *
 * One processor per queue (explicit concurrency + limiter, R-8), bounded
 * fan-out, per-store serialization, circuit-breaker gate with half-open
 * probe. Single-instance deployment: no separate worker process (§4.2).
 *
 * SaaS (§3.5): every processor extends TenantWorkerHost — each job
 * carries tenantId (stamped by SyncQueuesService.enqueue) and handle()
 * runs inside that tenant's context, so Prisma resolves the tenant pool
 * and RLS applies. G-4 worker-level flag check: a queued job REFUSES to
 * run when its kill-switch is off (returns `{ refused: true }` — the job
 * completes, it does not fail/retry). The three scheduled ticks
 * (order-reconcile-tick, retention-purge, stock-audit) carry
 * `{ fanOut: true }` and no single tenant: process() intercepts them
 * and sweeps ACTIVE tenants inline via runPerTenant (manual triggers
 * carry tenantId and go through the normal path).
 */
import { Processor } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';
import { TenantWorkerHost, runPerTenant } from '../../tenancy/tenant-job';
import { ProductSyncService, SYNC_FANOUT_CONCURRENCY_DEFAULT } from './product-sync.service';
import { DistributionService } from '../distribution/distribution.service';
import { StockStatusSyncService } from './stock-status-sync.service';
import { SyncRunService } from './sync-run.service';
import { SyncRetentionService } from './sync-retention.service';
import { SyncQueuesService, fanoutConcurrency } from './sync-queues.service';
import { StoreCircuitBreaker } from './sync-circuit';
import { StoreOrderIngestService, ZERO_STOCK_REJECT } from '../orders/store-order-ingest.service';
import { orderSyncSkipReason, type OrderSyncSkipReason } from '../store-sync-scope';
import { recordWebhookSkip } from '../webhooks/webhook-failure-recorder';
import {
  WebhookFailuresService,
  sanitizeFailurePayload,
} from '../webhooks/webhook-failures.service';
import { StoreOrderReconcileService } from '../orders/store-order-reconcile.service';
import { StoreOrderPushService } from '../orders/store-order-push.service';
import { WebhookHealthScheduler } from '../webhooks/webhook-health.scheduler';
import { classifyProviderError, MAX_SYNC_ATTEMPTS, RETRY_BACKOFF_MS } from '../providers/retry-classifier';
import {
  orderPushEnabled,
  orderSyncEnabled,
  productSyncEnabled,
  reconcileEnabled,
  stockAuditEnabled,
  stockSyncEnabled,
  storesEnabled,
} from '../store-flags';

async function boundedMap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * G-8 empty-sweep wording: an empty sweep used to report bare success
 * with 0 counts and no explanation. The SKIPPED item says what happened
 * and why (push is outbound-only — it never imports).
 */
export const EMPTY_SWEEP_REASON =
  'EMPTY_SWEEP: 0 products assigned — nothing to push; product sync pushes EcoMate products out, it does not import';

/**
 * D-4 sweep list, shared by the manual store sweep and the reconcile
 * product safety net: assignment rows first (the sweep's historical
 * product list), then rule-matched products fill the remainder up to
 * `cap`. Deduped — a product with both an assignment row and a matching
 * rule syncs exactly once. Rule matches are NEVER materialized into
 * assignment rows (no writes here). Without a DistributionService
 * (legacy manual constructions) the list is assignments-only.
 */
export async function sweepProductIds(
  prisma: PrismaService,
  distribution: DistributionService | undefined,
  storeId: string,
  cap: number,
): Promise<string[]> {
  const assignments = await prisma.productStoreAssignment.findMany({
    where: { storeId }, select: { productId: true }, take: cap,
  });
  const ids = (assignments as any[]).map((a) => a.productId as string);
  if (distribution && ids.length < cap) {
    const ruleIds = await distribution.ruleMatchedProductIds(storeId, cap - ids.length);
    const seen = new Set(ids);
    for (const id of ruleIds) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

@Processor('store-product-sync', { concurrency: 5, limiter: { max: 20, duration: 1000 } })
export class StoreProductSyncProcessor extends TenantWorkerHost {
  private readonly logger = new Logger(StoreProductSyncProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductSyncService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly breaker: StoreCircuitBreaker,
    @Optional() tenantRegistry?: TenantRegistryService,
    // D-4 rule-matched sweep. Trailing @Optional so specs constructing
    // the processor positionally keep working; production always wires
    // it via StoresModule. Without it the sweep is assignments-only.
    @Optional() private readonly distribution?: DistributionService,
  ) {
    super(tenantRegistry);
  }

  protected async handle(job: Job): Promise<unknown> {
    // G-4: a queued job refuses to run when its kill-switch is off.
    if (!productSyncEnabled()) {
      this.logger.log(`product sync refused (flag off): job ${job.name} ${job.id ?? ''}`);
      return { refused: true };
    }
    if (job.name === 'sync-all') return this.fanOut(job);
    const { runId, storeId, productId } = job.data as { runId: string; storeId: string; productId?: string };
    return this.queues.serializeStore(storeId, async () => {
      if (!(await this.breaker.allow(storeId))) {
        this.logger.warn(`breaker open for ${storeId} — requeueing probe`);
        throw new Error(`circuit-open:${storeId}`);
      }
      // BR-09: permanent EcoMate deletion propagates here (enqueued
      // post-commit by ProductsService.remove — never inline). Mapping
      // cleanup + capability gating live in deleteRemote.
      if (job.name === 'product-delete') {
        if (!productId) return { ignored: job.name };
        return this.products.deleteRemote(storeId, productId);
      }
      try {
        const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
        if (productId) {
          const r = await this.products.syncProduct(storeId, productId, runId);
          counts.updated += r.pushed.length;
          counts.skipped += r.skipped.length;
        } else {
          // Store sweep (D-4): assignment rows + rule-matched products,
          // deduped, capped at 500 total (assignments first).
          const ids = await sweepProductIds(this.prisma, this.distribution, storeId, 500);
          if (ids.length === 0) {
            // G-8: an empty sweep says so — one SKIPPED item, skipped: 1,
            // status stays SUCCESS (finish() maps failed:0 → SUCCESS).
            await this.runs.recordItem(runId, {
              storeId, objectType: 'PRODUCT', status: 'SKIPPED',
              reason: EMPTY_SWEEP_REASON, auditLevel: 'G',
            });
            counts.skipped += 1;
          }
          const limit = fanoutConcurrency();
          const results = await boundedMap(ids, limit, async (pid: string) => {
            try {
              return await this.products.syncProduct(storeId, pid, runId);
            } catch (err) {
              const decision = classifyProviderError(err);
              await this.runs.recordAttempt({
                runId, storeId, objectType: 'PRODUCT', objectKey: `store:${storeId}:product:${pid}`,
                productId: pid, status: 'FAILED', errorCategory: String(decision.category),
                errorMessage: err instanceof Error ? err.message : String(err),
              });
              // BR-26: a failure NEVER resolves ownership — no state writes here.
              counts.failed += 1;
              return null;
            }
          });
          for (const r of results) {
            if (!r) continue;
            counts.updated += r.pushed.length;
            counts.skipped += r.skipped.length;
          }
        }
        await this.breaker.success(storeId);
        await this.runs.finish(runId, { created: counts.created, updated: counts.updated, skipped: counts.skipped, failed: counts.failed });
        return counts;
      } catch (err) {
        await this.breaker.failure(storeId);
        // §8.1 retry ladder (30s→6h, 5 attempts → DEAD + issue). BullMQ
        // attempts are 1 — the engine owns retries so classification stays
        // pure and permanent failures never loop. BR-26: failures never
        // resolve ownership — only attempt/issue rows are written here.
        const decision = classifyProviderError(err);
        const objectKey = productId ? `store:${storeId}:product:${productId}` : `store:${storeId}:sweep`;
        const prior = await this.runs.countAttempts(storeId, objectKey);
        const attemptNo = prior + 1;
        const nextRetryAt = !decision.retryable || attemptNo >= MAX_SYNC_ATTEMPTS
          ? undefined
          : new Date(Date.now() + RETRY_BACKOFF_MS[Math.min(attemptNo - 1, RETRY_BACKOFF_MS.length - 1)]);
        await this.runs.recordAttempt({
          runId, storeId, objectType: 'PRODUCT', objectKey, productId,
          attemptNo, status: nextRetryAt ? 'PENDING' : 'DEAD',
          errorCategory: String(decision.category),
          errorMessage: err instanceof Error ? err.message : String(err),
          nextRetryAt,
        });
        if (!nextRetryAt) {
          await this.runs.upsertIssue({
            storeId, code: 'DEAD_LETTER', objectType: 'PRODUCT', objectKey, productId,
            message: `Sync dead after ${attemptNo} attempts (${decision.category}): ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 });
        throw err;
      }
    });
  }

  private async fanOut(job: Job): Promise<unknown> {
    const { batchRunId, scope } = job.data as { batchRunId: string; scope: string };
    // Tenant-scoped by the worker's tenant context (Prisma middleware).
    const stores = await this.prisma.store.findMany({ where: { status: { not: 'DISCONNECTED' } } });
    const external = (stores as any[]).filter((s) => s.kind !== 'NATIVE');
    const excludedNativeCount = (stores as any[]).length - external.length;
    const limit = fanoutConcurrency() || SYNC_FANOUT_CONCURRENCY_DEFAULT;
    const childRunIds: string[] = [];
    await boundedMap(external, limit, async (store: any) => {
      const child = await this.runs.begin({ scope: (scope as any) ?? 'PRODUCT', triggerType: 'MANUAL', storeId: store.id });
      childRunIds.push((child as any).id);
      await this.queues.enqueue('store-product-sync', 'store-sync', { runId: (child as any).id, storeId: store.id }, `store-sync:${(child as any).id}`);
    });
    await this.runs.finish(batchRunId, { created: childRunIds.length, updated: 0, skipped: excludedNativeCount, failed: 0 });
    return { batchRunId, childRunIds, excludedNativeCount };
  }
}

@Processor('store-stock-sync', { concurrency: 10, limiter: { max: 30, duration: 1000 } })
export class StoreStockSyncProcessor extends TenantWorkerHost {
  private readonly logger = new Logger(StoreStockSyncProcessor.name);
  constructor(
    private readonly runs: SyncRunService,
    private readonly stock: StockStatusSyncService,
    private readonly queues: SyncQueuesService,
    @Optional() tenantRegistry?: TenantRegistryService,
  ) { super(tenantRegistry); }

  override async process(job: Job): Promise<unknown> {
    // Scheduled stock-audit tick: no single tenant — sweep ACTIVE tenants.
    if ((job.data as any)?.fanOut === true && job.name === 'stock-audit') {
      if (!stockAuditEnabled()) {
        this.logger.log('stock audit refused (flag off)');
        return { refused: true };
      }
      const { succeeded, failed } = await runPerTenant(
        this.tenantRegistry,
        async () => {
          await this.stock.runAudit({});
        },
        (tenantId, err) => this.logger.error(`stock audit failed for tenant ${tenantId}: ${err}`),
      );
      return { fanOut: true, succeeded, failed };
    }
    return super.process(job);
  }

  protected async handle(job: Job): Promise<unknown> {
    // G-4: a queued job refuses to run when its kill-switch is off.
    if (!stockSyncEnabled()) {
      this.logger.log(`stock sync refused (flag off): job ${job.name} ${job.id ?? ''}`);
      return { refused: true };
    }
    // P5 owns stock-status sync (§8.4): per-change jobs serialize per store
    // (R-8); the daily audit spans stores and runs unserialized — the
    // monotonic version guard keeps the two paths from racing.
    if (job.name === 'stock-change') {
      const { storeId } = (job.data ?? {}) as { storeId?: string };
      if (!storeId) {
        this.logger.warn('stock-change without storeId — ignored');
        return { ignored: 'missing-storeId' };
      }
      return this.queues.serializeStore(storeId, () =>
        this.stock.handleStockChange((job.data ?? {}) as any),
      );
    }
    if (job.name === 'stock-audit') {
      // Tenant-scoped audit (manual trigger or cursor continuation from
      // runAudit itself) — the scheduled tick is intercepted in process().
      return this.stock.runAudit((job.data ?? {}) as any);
    }
    // Manual per-store stock-only sweep (store detail "Sync stock" button):
    // evaluates every assigned product (variant fan-out inside), bounded.
    if (job.name === 'stock-store-sweep') {
      const { runId, storeId } = (job.data ?? {}) as { runId?: string; storeId?: string };
      if (!runId || !storeId) {
        this.logger.warn('stock-store-sweep without runId/storeId — ignored');
        return { ignored: 'missing-ids' };
      }
      return this.queues.serializeStore(storeId, () =>
        this.stock.sweepStore(storeId, runId),
      );
    }
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'PRODUCT', status: 'SKIPPED', reason: 'UNKNOWN_STOCK_JOB: ignored (P5 owns stock-status sync)', auditLevel: 'G',
      });
    }
    return { ignored: true };
  }
}

/**
 * G-12 ingest retry classification (pure, unit-tested): is this ingest
 * failure PERMANENT — i.e. no retry within the BullMQ ladder (attempts 3,
 * exponential backoff) can fix it? Permanent failures throw
 * `UnrecoverableError` so BullMQ skips the remaining attempts and the
 * failure lands in the failure table immediately; everything else
 * rethrows as a plain error so the ladder retries it.
 *
 * Permanent today: the P13 zero-stock reject (stock will not reappear
 * within seconds — recovery is the hourly reconcile or a manual replay
 * after restock) and Prisma record/relation errors that a retry cannot
 * repair (store or order vanished mid-flight). Unknown errors default
 * to RETRYABLE — a transient DB/Redis blip must never be written off.
 * (Deliberately NOT `classifyProviderError`: that helper is fail-closed
 * toward non-retryable, which is backwards for ingest.)
 */
export function isPermanentIngestError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg.includes(ZERO_STOCK_REJECT)) return true;
  const code = (err as any)?.code;
  if (code === 'P2003' || code === 'P2025') return true;
  return false;
}

@Processor('store-order-ingest', { concurrency: 5, limiter: { max: 20, duration: 1000 } })
export class StoreOrderIngestProcessor extends TenantWorkerHost {
  private readonly logger = new Logger(StoreOrderIngestProcessor.name);
  constructor(
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly ingest: StoreOrderIngestService,
    @Optional() tenantRegistry?: TenantRegistryService,
    // G-08/G-09 (J-09 defense in depth): trailing @Optional so specs
    // constructing the processor positionally (3 args) keep working; the
    // gate is a no-op without Prisma. Production always wires it.
    @Optional() private readonly prisma?: PrismaService,
    // G-12/G-16: trailing @Optional so specs constructing the processor
    // positionally keep working. Without them, replay jobs degrade to
    // the missing-payload path and ingest failures skip the failure
    // row (the SyncRunItem + issue rows still record them).
    // Production always wires both.
    @Optional() private readonly failures?: WebhookFailuresService,
    @Optional() private readonly reconcile?: StoreOrderReconcileService,
  ) { super(tenantRegistry); }

  /**
   * G-08/G-09 second-layer check: re-read the store's auto-sync /
   * sync-scope settings at execution time. Returns the skip reason, or
   * null when ingest may proceed. FAILS OPEN: no Prisma, a missing
   * store row, or a lookup error all allow ingest (a gate failure must
   * never suppress orders — the intake layer already gated the common
   * case, and a transient DB error here would otherwise drop the job).
   */
  private async orderSyncSkip(storeId: string): Promise<OrderSyncSkipReason | null> {
    if (!this.prisma) return null;
    try {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { autoSyncEnabled: true, settings: true },
      });
      return orderSyncSkipReason(store);
    } catch (err) {
      this.logger.warn(
        `order ingest gate lookup failed for store ${storeId} — proceeding: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * P6 ingest execution (BR-11/BR-12): webhook + reconcile funnels share one
   * job identity (`store:{storeId}:order:{externalId}`); per-store
   * serialization keeps a store's deliveries ordered (R-8).
   */
  protected async handle(job: Job): Promise<unknown> {
    // G-4: a queued job refuses to run when its kill-switch is off.
    // G-10: the refusal MUST finish the run — the pre-fix path returned
    // `{ refused: true }` without finishing, stranding a permanently
    // RUNNING row (same defect class as the fixed D-3/ND-1 bugs). The
    // run finishes as skipped:1 with a SKIPPED item carrying the
    // refusal reason (SyncRunStatus has no REFUSED value; the item is
    // the visible record).
    const earlyRunId = (job.data as any)?.runId as string | undefined;
    const earlyStoreId = (job.data as any)?.storeId as string | undefined;
    if (!orderSyncEnabled()) {
      this.logger.log(`order ingest refused (flag off): job ${job.name} ${job.id ?? ''}`);
      if (earlyRunId) {
        await this.runs.recordItem(earlyRunId, {
          ...(earlyStoreId ? { storeId: earlyStoreId } : {}),
          objectType: 'ORDER', status: 'SKIPPED', reason: 'ORDER_INGEST_REFUSED_FLAG_OFF', auditLevel: 'G',
        });
        await this.runs.finish(earlyRunId, { created: 0, updated: 0, skipped: 1, failed: 0 });
      }
      return { refused: true };
    }
    const { runId, storeId, rawOrder, deliveryKey, topic, provider, replayFailureId, externalOrderId, replayWindowDays } = (job.data ?? {}) as {
      runId?: string; storeId?: string; rawOrder?: Record<string, unknown>; deliveryKey?: string;
      topic?: string; provider?: string;
      replayFailureId?: string; externalOrderId?: string; replayWindowDays?: number;
    };
    // G-12 manual replay (`webhook-order-retry`): no rawOrder rides the
    // job — the order is re-fetched from the provider through the
    // bounded reconcile path, then the failure row resolves only if the
    // mapping exists afterwards (verified resolution, never assumed).
    // A replay is an explicit operator act, so it runs BEFORE the
    // G-08/G-09 auto-sync gate below (that gate governs AUTOMATIC
    // arrival, not a manual retry) — but AFTER the G-4 kill switch
    // above (global safety still wins). `runStore` finishes the run
    // itself — this branch must NOT finish it again.
    if (!rawOrder && replayFailureId && externalOrderId && storeId && runId && this.reconcile) {
      return this.queues.serializeStore(storeId, async () => {
        try {
          const counts = await this.reconcile!.runStore(storeId, runId, {
            requestedDays: replayWindowDays ?? 3,
            wideningReason: `webhook replay ${replayFailureId}`,
          });
          const resolved = this.failures
            ? await this.failures.resolveReplay(replayFailureId, storeId, externalOrderId)
            : false;
          return { replayed: true, resolved, ...counts };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`webhook replay failed (failure ${replayFailureId}): ${msg}`);
          // runStore never throws for provider failures (it records
          // FAILED + issue and finishes the run) — a throw here is an
          // unexpected defect, so the run still needs finishing.
          await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 }).catch(() => undefined);
          if (deliveryKey) {
            await this.failures?.recordFailureSafe({
              storeId, deliveryKey, topic: topic ?? null, reason: 'INGEST_FAILED',
            });
          }
          throw err;
        }
      });
    }
    if (!storeId || !rawOrder) {
      if (runId) {
        await this.runs.recordItem(runId, {
          objectType: 'ORDER', status: 'SKIPPED', reason: 'ORDER_INGEST_MISSING_PAYLOAD', auditLevel: 'G',
        });
        // ND-1: finish the run as FAILED — the early return used to strand
        // a permanently RUNNING row. Reachable through real signed
        // webhooks (JSON-null body, or non-JSON text/plain body both
        // pass intake with 201 and enqueue a job with no payload).
        await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 });
      }
      return { ignored: 'missing-payload' };
    }
    // G-08/G-09 (J-09 defense in depth): a job enqueued before the
    // operator flipped auto-sync / scope off must not ingest. Intake
    // already gates; this re-checks at execution time, BEFORE taking
    // the per-store lock. A skip finishes the run as skipped (never
    // stranded RUNNING) and records a visible IGNORED failure row.
    const syncSkip = await this.orderSyncSkip(storeId);
    if (syncSkip) {
      this.logger.log(`order ingest skipped (store ${storeId}): ${syncSkip}`);
      if (this.prisma) {
        await recordWebhookSkip(this.prisma, {
          tenantId: (job.data as any)?.tenantId ?? null,
          storeId,
          deliveryKey,
          topic: topic ?? null,
          reason: syncSkip,
        });
      }
      if (runId) {
        await this.runs.recordItem(runId, {
          storeId,
          objectType: 'ORDER',
          status: 'SKIPPED',
          reason: syncSkip,
          auditLevel: 'G',
        });
        await this.runs.finish(runId, { created: 0, updated: 0, skipped: 1, failed: 0 });
      }
      return { skipped: true, reason: syncSkip, deliveryKey };
    }
    return this.queues.serializeStore(storeId, async () => {
      try {
        const res = await this.ingest.ingest(storeId, rawOrder, {
          type: job.name === 'webhook-order' ? 'WEBHOOK' : 'RECONCILE',
          runId,
          actor: job.name === 'webhook-order' ? 'webhook' : 'reconcile',
          topic,
          provider,
        });
        // D-3: every other processor finishes its run; ingest never did,
        // leaving a permanently RUNNING row per webhook. A fresh order
        // counts as created; a reconcile that moved the status counts as
        // updated; an unchanged replay counts as skipped.
        if (runId) {
          await this.runs.finish(runId, {
            created: res.created ? 1 : 0,
            updated: !res.created && res.statusChanged ? 1 : 0,
            skipped: !res.created && !res.statusChanged ? 1 : 0,
            failed: 0,
          });
        }
        // G-12: a retry that finally succeeds resolves the failure row
        // its earlier attempts recorded. Only on retries
        // (attemptsMade > 0) — the first-attempt happy path must not pay
        // an extra write per order.
        if (deliveryKey && (job as any).attemptsMade > 0) {
          await this.failures?.resolveByDeliveryKey(deliveryKey).catch(() => undefined);
        }
        return { ...res, deliveryKey };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`order ingest failed (store ${storeId}): ${msg}`);
        if (runId) {
          await this.runs.recordItem(runId, {
            storeId,
            objectType: 'ORDER',
            status: 'FAILED',
            reason: `ORDER_INGEST_FAILED: ${msg}`,
            auditLevel: 'G',
          });
        }
        await this.runs.upsertIssue({
          storeId,
          code: 'ORDER_INGEST_FAILED',
          objectType: 'ORDER',
          objectKey: `store:${storeId}:ingest:${deliveryKey ?? 'unknown'}`,
          message: `Order ingest failed: ${msg}`,
        });
        // G-16: record the failure row (webhook jobs only — reconcile
        // failures already have SyncAttempt/issue rows, and a reconcile
        // job carries no deliveryKey). The row upserts by deliveryKey,
        // so each BullMQ retry bumps `occurrences` instead of spamming
        // rows; a later successful retry resolves it (above).
        if (deliveryKey) {
          await this.failures?.recordFailureSafe({
            storeId,
            deliveryKey,
            topic: topic ?? null,
            reason: 'INGEST_FAILED',
            payload: sanitizeFailurePayload(rawOrder),
          });
        }
        // D-3: finish the run as FAILED (mirrors the product processor)
        // before the rethrow marks the BullMQ job failed.
        if (runId) {
          await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 });
        }
        // G-12: permanent failures skip the remaining BullMQ attempts
        // (UnrecoverableError) — retrying a zero-stock reject in 5s
        // cannot help. Transient failures rethrow plainly so the
        // attempts-3 exponential ladder retries them.
        if (isPermanentIngestError(err)) throw new UnrecoverableError(msg);
        throw err;
      }
    });
  }
}

@Processor('store-order-push', { concurrency: 5, limiter: { max: 20, duration: 1000 } })
export class StoreOrderPushProcessor extends TenantWorkerHost {
  private readonly logger = new Logger(StoreOrderPushProcessor.name);
  constructor(
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly push: StoreOrderPushService,
    @Optional() tenantRegistry?: TenantRegistryService,
  ) { super(tenantRegistry); }

  /**
   * P7 status-push execution (§8.6): per-store serialization (R-8); the
   * worker owns idempotency (lastPushedStatus), capability gating,
   * read-back verification and the standard retry ladder. Unknown job
   * names are an explicit skip, never silent.
   */
  protected async handle(job: Job): Promise<unknown> {
    // G-4: a queued job refuses to run when its kill-switch is off.
    if (!orderPushEnabled()) {
      this.logger.log(`order push refused (flag off): job ${job.name} ${job.id ?? ''}`);
      return { refused: true };
    }
    if (job.name === 'order-status-push') {
      const { storeId } = (job.data ?? {}) as { storeId?: string };
      if (!storeId) {
        this.logger.warn('order-status-push without storeId — ignored');
        return { ignored: 'missing-storeId' };
      }
      return this.queues.serializeStore(storeId, () =>
        this.push.handlePush((job.data ?? {}) as any),
      );
    }
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'ORDER', status: 'SKIPPED', reason: `UNKNOWN_PUSH_JOB:${job.name}: ignored`, auditLevel: 'G',
      });
    }
    return { ignored: job.name };
  }
}

@Processor('store-reconcile', { concurrency: 2, limiter: { max: 5, duration: 1000 } })
export class StoreReconcileProcessor extends TenantWorkerHost {
  private readonly logger = new Logger(StoreReconcileProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductSyncService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly orderReconcile: StoreOrderReconcileService,
    @Optional() tenantRegistry?: TenantRegistryService,
    // D-4 rule-matched safety net (same helper as the manual sweep).
    // Trailing @Optional — see StoreProductSyncProcessor.
    @Optional() private readonly distribution?: DistributionService,
  ) { super(tenantRegistry); }

  override async process(job: Job): Promise<unknown> {
    // Hourly reconcile tick: no single tenant — sweep ACTIVE tenants.
    if ((job.data as any)?.fanOut === true && job.name === 'order-reconcile-tick') {
      if (!reconcileEnabled()) {
        this.logger.log('order reconcile tick refused (flag off)');
        return { refused: true };
      }
      const { succeeded, failed } = await runPerTenant(
        this.tenantRegistry,
        async () => {
          await this.orderReconcile.tickHourly();
        },
        (tenantId, err) => this.logger.error(`reconcile tick failed for tenant ${tenantId}: ${err}`),
      );
      return { fanOut: true, succeeded, failed };
    }
    return super.process(job);
  }

  protected async handle(job: Job): Promise<unknown> {
    // G-4: a queued job refuses to run when its kill-switch is off.
    if (!reconcileEnabled()) {
      this.logger.log(`reconcile refused (flag off): job ${job.name} ${job.id ?? ''}`);
      return { refused: true };
    }
    // P6 order reconcile (BR-10/BR-11): hourly tick fans out per-store bounded
    // runs; manual triggers land here with the same bounds.
    if (job.name === 'order-reconcile-tick') {
      // Tenant-scoped tick (manual trigger from the console) — the
      // scheduled fan-out tick is intercepted in process().
      return this.orderReconcile.tickHourly();
    }
    if (job.name === 'order-reconcile') {
      const { runId, storeId, requestedDays, wideningReason } = job.data as {
        runId: string; storeId: string; requestedDays?: number; wideningReason?: string;
      };
      return this.queues.serializeStore(storeId, () =>
        this.orderReconcile.runStore(storeId, runId, { requestedDays, wideningReason }),
      );
    }
    // Hourly product safety-net: re-run the ownership engine over assigned
    // products (bounded 3-day window semantics land with order reconcile in
    // P6; product re-verification here never resolves — BR-26).
    const { runId, storeId, windowDays, wideningReason } = job.data as {
      runId: string; storeId: string; windowDays?: number; wideningReason?: string;
    };
    void windowDays; void wideningReason;
    return this.queues.serializeStore(storeId, async () => {
      // D-4: same assignment + rule-matched union as the manual sweep
      // (cap 200). No EMPTY_SWEEP item here — the safety net runs
      // unattended and an empty net is the normal idle state.
      const ids = await sweepProductIds(this.prisma, this.distribution, storeId, 200);
      let failed = 0;
      let updated = 0;
      for (const pid of ids) {
        try {
          const r = await this.products.syncProduct(storeId, pid, runId);
          updated += r.pushed.length;
        } catch (err) {
          failed += 1;
          this.logger.warn(`reconcile item failed (no resolution): ${err}`);
        }
      }
      await this.runs.finish(runId, { created: 0, updated, failed });
      return { updated, failed };
    });
  }
}

@Processor('store-maintenance', { concurrency: 1, limiter: { max: 2, duration: 1000 } })
export class StoreMaintenanceProcessor extends TenantWorkerHost {
  private readonly logger = new Logger(StoreMaintenanceProcessor.name);
  constructor(
    private readonly runs: SyncRunService,
    private readonly retention: SyncRetentionService,
    @Optional() tenantRegistry?: TenantRegistryService,
    // Webhook lifecycle (G-05/G-06): hourly health tick. Trailing @Optional
    // so existing manual constructions keep working.
    @Optional() private readonly webhookHealth?: WebhookHealthScheduler,
  ) { super(tenantRegistry); }

  override async process(job: Job): Promise<unknown> {
    // Daily retention purge tick: no single tenant — sweep ACTIVE tenants.
    if ((job.data as any)?.fanOut === true && job.name === 'retention-purge') {
      if (!storesEnabled()) {
        this.logger.log('retention purge refused (flag off)');
        return { refused: true };
      }
      const { succeeded, failed } = await runPerTenant(
        this.tenantRegistry,
        async () => {
          await this.retention.purge(new Date());
        },
        (tenantId, err) => this.logger.error(`retention purge failed for tenant ${tenantId}: ${err}`),
      );
      return { fanOut: true, succeeded, failed };
    }
    // Hourly webhook-health tick: no single tenant — sweep ACTIVE tenants.
    if ((job.data as any)?.fanOut === true && job.name === 'webhook-health-tick') {
      if (!storesEnabled()) {
        this.logger.log('webhook health check refused (flag off)');
        return { refused: true };
      }
      if (!this.webhookHealth) {
        this.logger.warn('webhook health scheduler not wired; tick ignored');
        return { ignored: job.name };
      }
      const totals = { checked: 0, healed: 0, failed: 0 };
      const { succeeded, failed } = await runPerTenant(
        this.tenantRegistry,
        async () => {
          const r = await this.webhookHealth!.checkTenantStores();
          totals.checked += r.checked;
          totals.healed += r.healed;
          totals.failed += r.failed;
        },
        (tenantId, err) => this.logger.error(`webhook health check failed for tenant ${tenantId}: ${err}`),
      );
      // `failed` keeps the runPerTenant meaning (tenants whose sweep
      // threw — same shape as the retention-purge branch); the
      // per-store ensure failures ride as `failedStores` (TS2783: the
      // spread of `totals` used to overwrite `failed`).
      return {
        fanOut: true,
        succeeded,
        failed,
        checked: totals.checked,
        healed: totals.healed,
        failedStores: totals.failed,
      };
    }
    return super.process(job);
  }

  protected async handle(job: Job): Promise<unknown> {
    // G-4: a queued job refuses to run when its kill-switch is off.
    // (Maintenance is hygiene — only the master kill-switch gates it.)
    if (!storesEnabled()) {
      this.logger.log(`maintenance refused (flag off): job ${job.name} ${job.id ?? ''}`);
      return { refused: true };
    }
    // P11 BR-19: daily bounded retention purge (additive; the queue bounds
    // predate P11). Heavy work runs here, never in the HTTP request (BR-21).
    if (job.name === 'retention-purge') {
      return this.retention.purge(new Date());
    }
    // Webhook lifecycle (G-05/G-06): tenant-scoped health tick (manual
    // trigger from the console) — the scheduled fan-out tick is
    // intercepted in process().
    if (job.name === 'webhook-health-tick') {
      if (!this.webhookHealth) return { ignored: job.name };
      return this.webhookHealth.checkTenantStores();
    }
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'PRODUCT', status: 'SKIPPED', reason: 'UNKNOWN_MAINTENANCE_JOB: ignored', auditLevel: 'G',
      });
    }
    return { ignored: job.name };
  }
}
