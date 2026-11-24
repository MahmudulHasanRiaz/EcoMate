/**
 * Sync queues — central-commerce §8.1 (P4).
 *
 * Six queues, each with explicit `concurrency` + `limiter` (R-8: sync
 * volume shares Redis with email/backup/tracking — explicit bounds so a
 * product flood cannot starve them). Per-store serialization via Redis
 * locks (CacheService); per-store Redis circuit breaker with half-open
 * probe; fan-out concurrency cap (default 5, `store_sync_fanout_concurrency`).
 * Heavy work NEVER runs in the HTTP request: triggers enqueue and return
 * `{ runId }` immediately (BR-21).
 *
 * SaaS (§3.5): every job carries `tenantId` (tenantJobPayload — the
 * processors run inside the job's tenant context), and `enqueue` enforces
 * the tenant entitlement for the queue (a downgraded tenant's sync
 * triggers silently no-op instead of queueing work the worker would
 * refuse — R-2: never throws into the caller). Fan-out ticks
 * (reconcile/retention/audit) carry no single tenant and are enqueued
 * with `opts.fanOut` — the processor intercepts them and sweeps ACTIVE
 * tenants inline via runPerTenant.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SyncRunService } from './sync-run.service';
import { CacheService } from '../../cache/cache.service';
import { TenantEntitlementsService } from '../../tenancy/tenant-entitlements.service';
import { tenantJobPayload } from '../../tenancy/tenant-job';

export const SYNC_QUEUE_NAMES = [
  'store-product-sync',
  'store-stock-sync',
  'store-order-ingest',
  'store-order-push',
  'store-reconcile',
  'store-maintenance',
  'store-product-import',
  'store-product-import-images',
] as const;

export type SyncQueueName = (typeof SYNC_QUEUE_NAMES)[number];

/** Queue → feature key for the enqueue entitlement check (null = no check: hygiene queue). */
const QUEUE_FEATURE_KEY: Record<SyncQueueName, string | null> = {
  'store-product-sync': 'store_product_sync',
  'store-stock-sync': 'store_stock_sync',
  'store-order-ingest': 'store_order_sync',
  'store-order-push': 'store_order_sync',
  // Order reconcile is the queue's primary work (the product
  // re-verification sweep inside is a safety net, not a product sync).
  'store-reconcile': 'store_order_sync',
  'store-maintenance': null,
  // Import is product sync, inbound direction (D2) — same key, and the
  // image queue inherits it (images are part of the import, never standalone).
  'store-product-import': 'store_product_sync',
  'store-product-import-images': 'store_product_sync',
};

/** How long a job waits for another job on the same store before failing (the engine retry ladder re-enqueues). */
const STORE_LOCK_WAIT_MS = 120_000;
/** Lock TTL — bounds a crashed holder's block; single-store jobs run far shorter. */
const STORE_LOCK_TTL_MS = 10 * 60_000;
const STORE_LOCK_POLL_MS = 250;

export function fanoutConcurrency(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env['store_sync_fanout_concurrency'] ?? 5);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

@Injectable()
export class SyncQueuesService {
  private readonly logger = new Logger(SyncQueuesService.name);
  /** Per-store serialization chains — unit-test fallback when no CacheService is wired (production always has one). */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    @InjectQueue('store-product-sync') private readonly productQ: Queue,
    @InjectQueue('store-stock-sync') private readonly stockQ: Queue,
    @InjectQueue('store-order-ingest') private readonly ingestQ: Queue,
    @InjectQueue('store-order-push') private readonly pushQ: Queue,
    @InjectQueue('store-reconcile') private readonly reconcileQ: Queue,
    @InjectQueue('store-maintenance') private readonly maintenanceQ: Queue,
    private readonly runs: SyncRunService,
    // @Optional so specs constructing the service manually with the six
    // legacy queues keep working; production always wires both. Trailing
    // (after the required `runs`) — TS forbids required params after
    // optional ones.
    @Optional() @InjectQueue('store-product-import') private readonly importQ?: Queue,
    @Optional() @InjectQueue('store-product-import-images') private readonly importImagesQ?: Queue,
    // Trailing @Optional so specs constructing the service manually keep
    // working; production always wires both via StoresModule.
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly entitlements?: TenantEntitlementsService,
  ) {}

  private queueFor(name: SyncQueueName): Queue {
    switch (name) {
      case 'store-product-sync': return this.productQ;
      case 'store-stock-sync': return this.stockQ;
      case 'store-order-ingest': return this.ingestQ;
      case 'store-order-push': return this.pushQ;
      case 'store-reconcile': return this.reconcileQ;
      case 'store-maintenance': return this.maintenanceQ;
      case 'store-product-import':
        if (!this.importQ) throw new Error('store-product-import queue is not wired');
        return this.importQ;
      case 'store-product-import-images':
        if (!this.importImagesQ) throw new Error('store-product-import-images queue is not wired');
        return this.importImagesQ;
    }
  }

  /**
   * Drop a FINISHED (completed/failed) job record so a re-add with the same
   * id actually runs. BullMQ dedupes by job id while ANY record exists —
   * with removeOnComplete retention, a second stock change for the same
   * product would otherwise be silently swallowed by the first job's
   * completed record (live find: 3→0 never evaluated). Pending
   * (waiting/delayed/active) jobs are left alone: they re-read live state
   * at run time, so coalescing stays safe.
   */
  async replaceFinishedJob(name: SyncQueueName, jobId: string): Promise<void> {
    try {
      const safe = jobId.replace(/:/g, '-');
      const existing = await this.queueFor(name).getJob(safe);
      if (!existing) return;
      if (await existing.isCompleted().catch(() => false)) {
        await existing.remove().catch(() => undefined);
        return;
      }
      if (await existing.isFailed().catch(() => false)) {
        await existing.remove().catch(() => undefined);
      }
    } catch {
      // Best-effort only — worst case the add below dedupes as before.
    }
  }

  /**
   * Enqueue post-commit; never throws into the caller (R-2).
   *
   * SaaS: the payload is stamped with the current tenant
   * (tenantJobPayload) so the processor runs in that tenant's context,
   * and the queue's feature entitlement is checked first — a tenant
   * whose plan no longer includes the feature silently enqueues nothing
   * (log + return, never a throw: the callers are post-commit notifies).
   * Fan-out ticks pass `opts.fanOut` and skip both (no single tenant).
   *
   * Callers that must know whether the job queued (webhook intake,
   * manual replay — G-11) use `enqueueOrThrow` instead. This method's
   * swallow-and-log behavior is load-bearing for every other caller
   * and must not change.
   *
   * Phase 9 G-14: `opts.priority` overrides the queue's
   * `defaultJobOptions.priority` for this job (see WEBHOOK_PRIORITY:
   * manual-retry 1, webhook 5, reconciliation 10). Omitted → the
   * queue default applies, so existing callers are unaffected.
   */
  async enqueue(
    name: SyncQueueName,
    jobName: string,
    data: Record<string, unknown>,
    jobId?: string,
    opts?: { delay?: number; fanOut?: boolean; priority?: number },
  ): Promise<void> {
    try {
      await this.enqueueInternal(name, jobName, data, jobId, opts);
    } catch (err) {
      this.logger.error(`enqueue ${name}/${jobName} failed (non-propagating): ${err}`);
    }
  }

  /**
   * Throwing enqueue variant (G-11): same stamping, entitlement check,
   * and job-id sanitization as `enqueue`, but a queue failure
   * PROPAGATES so the caller can surface it (webhook intake → 503,
   * replay → 503) instead of claiming success for a job that never
   * queued. Returns the BullMQ job, or `null` when the entitlement
   * check skipped the enqueue (not a failure — the caller decides
   * what a skip means for its own run/response).
   */
  async enqueueOrThrow(
    name: SyncQueueName,
    jobName: string,
    data: Record<string, unknown>,
    jobId?: string,
    opts?: { delay?: number; fanOut?: boolean; priority?: number },
  ): Promise<unknown | null> {
    return this.enqueueInternal(name, jobName, data, jobId, opts);
  }

  private async enqueueInternal(
    name: SyncQueueName,
    jobName: string,
    data: Record<string, unknown>,
    jobId?: string,
    opts?: { delay?: number; fanOut?: boolean; priority?: number },
  ): Promise<unknown | null> {
    if (!opts?.fanOut) {
      const key = QUEUE_FEATURE_KEY[name];
      if (key && this.entitlements && !this.entitlements.canUse(key)) {
        this.logger.log(
          `enqueue ${name}/${jobName} skipped: tenant lacks feature ${key}`,
        );
        return null;
      }
    }
    // BullMQ custom ids cannot contain ':' (key separator) — sanitize so a
    // store-scoped identity (`store:{id}:order:{ext}`) stays a valid job id
    // without losing uniqueness (P6 live-E2E find).
    const safeJobId = jobId?.replace(/:/g, '-');
    const payload = opts?.fanOut
      ? { ...data, fanOut: true }
      : tenantJobPayload(data);
    return this.queueFor(name).add(jobName, payload, {
      ...(safeJobId ? { jobId: safeJobId } : {}),
      ...(opts?.delay ? { delay: opts.delay } : {}),
      // G-14: an explicit priority overrides the queue default for
      // this job (manual replay = 1 jumps ahead of live webhooks = 5).
      // Omitted → BullMQ applies defaultJobOptions.priority.
      ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
      removeOnComplete: 100,
      removeOnFail: 50,
    });
  }

  /**
   * Serialize per store: run this unit of work holding the store's Redis
   * lock (cross-process — the upstream in-memory chain only serialized
   * within one process). Waits up to STORE_LOCK_WAIT_MS for a contended
   * lock, then throws so the processor's retry ladder re-enqueues (never
   * silently dropped). Without a CacheService (unit specs) falls back to
   * the upstream in-memory promise chain.
   */
  async serializeStore<T>(storeId: string, work: () => Promise<T>): Promise<T> {
    if (!this.cache) {
      const tail = this.chains.get(storeId) ?? Promise.resolve();
      const next = tail.then(work, work) as Promise<T>;
      this.chains.set(storeId, next.catch(() => undefined));
      return next;
    }
    const lockKey = `store:lock:${storeId}`;
    const deadline = Date.now() + STORE_LOCK_WAIT_MS;
    let token: string | null = null;
    while (Date.now() < deadline) {
      token = await this.cache.acquireLock(lockKey, STORE_LOCK_TTL_MS);
      if (token) break;
      await new Promise((r) => setTimeout(r, STORE_LOCK_POLL_MS));
    }
    if (!token) {
      throw new Error(
        `store lock timeout for ${storeId} — another sync holds the store lock`,
      );
    }
    try {
      return await work();
    } finally {
      await this.cache.releaseLock(lockKey, token).catch(() => undefined);
    }
  }

  /** Manual product-sync trigger: creates the run, enqueues, returns now. */
  async triggerStoreSync(storeId: string, scope: 'PRODUCT' | 'PUBLISH' = 'PRODUCT', initiatedById?: string): Promise<{ runId: string }> {
    const run = await this.runs.begin({ scope: scope as any, triggerType: 'MANUAL', storeId, initiatedById });
    const runId = (run as any).id as string;
    // Post-commit enqueue that cannot throw (R-2): fire-and-forget.
    void this.enqueue('store-product-sync', 'store-sync', { runId, storeId }, `store-sync:${runId}`).catch(() => undefined);
    return { runId };
  }

  /**
   * P1 per-product push: same run pattern as triggerStoreSync, but the
   * job carries `productId` — the processor's per-product branch then
   * syncs only that product through syncProduct (P0 media path).
   */
  async triggerProductSync(storeId: string, productId: string, initiatedById?: string): Promise<{ runId: string }> {
    const run = await this.runs.begin({ scope: 'PRODUCT' as any, triggerType: 'MANUAL', storeId, initiatedById });
    const runId = (run as any).id as string;
    // Post-commit enqueue that cannot throw (R-2): fire-and-forget.
    void this.enqueue('store-product-sync', 'store-sync', { runId, storeId, productId }, `store-sync:${runId}`).catch(() => undefined);
    return { runId };
  }

  async triggerSyncAll(scope: 'PRODUCT' | 'PUBLISH' = 'PRODUCT', initiatedById?: string): Promise<{ batchRunId: string; childRunIds: string[]; excludedNativeCount: number }> {
    const batch = await this.runs.begin({ scope: scope as any, triggerType: 'MANUAL', initiatedById });
    const batchRunId = (batch as any).id as string;
    // Store fan-out happens in the worker (bounded concurrency); the HTTP
    // request returns immediately with the batch id.
    void this.enqueue('store-product-sync', 'sync-all', { batchRunId, scope }, `sync-all:${batchRunId}`).catch(() => undefined);
    return { batchRunId, childRunIds: [], excludedNativeCount: 0 };
  }
}
