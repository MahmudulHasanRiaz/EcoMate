/**
 * Store order reconcile — central-commerce P6 (§8.5, BR-10/BR-11).
 *
 * Hourly BullMQ repeatable per connected non-NATIVE store:
 * `fetchOrders({ since: now − windowDays, until: now })`, paginated and
 * bounded (BR-10). Every order funnels through the SAME job identity as the
 * webhook path (StoreOrderIngestService.ingest) so the two paths cannot
 * double-work (BR-11/BR-12).
 *
 * Widening is opt-in, failure-driven, bounded (hard max 30 days), page-capped,
 * rate-limited and recorded on the run (`windowDays`, `wideningReason`).
 *
 * Phase 9 P2 — cap 5,000 orders/store/run (50 pages × 100), segmented:
 * a progress item lands every 10 pages, and a run that hits the cap
 * with more pages remaining enqueues ONE continuation run resuming
 * from the exact page/cursor with the original window frozen (run
 * metadata `reconcileResume`) — recovery drains across bounded runs
 * instead of truncating. See normalize-order.ts for the rationale.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantEntitlementsService } from '../../tenancy/tenant-entitlements.service';
import { SyncRunService } from '../sync/sync-run.service';
import { SyncQueuesService } from '../sync/sync-queues.service';
import { WEBHOOK_PRIORITY } from '../sync/webhook-priority';
import { StoreOrderIngestService } from './store-order-ingest.service';
import { StoresService } from '../stores.service';
import {
  clampReconcileWindow,
  normalizeOrder,
  RECONCILE_MAX_ORDERS_PER_RUN,
  RECONCILE_MAX_PAGES,
  RECONCILE_PAGE_SIZE,
  RECONCILE_SEGMENT_PAGES,
} from './normalize-order';
import { reconcileEnabled, reconcileWideningEnabled } from '../store-flags';

export interface ReconcileOptions {
  requestedDays?: number;
  wideningReason?: string;
  actor?: string;
}

/**
 * Phase 9 P2 — continuation resume point, carried in the continuation
 * run's `metadata.reconcileResume`. A capped run (50 pages) does not
 * truncate the recovery: it enqueues ONE continuation run that resumes
 * from the exact page/cursor with the ORIGINAL window frozen
 * (`since`/`until` — recomputing them would shift the trailing edge
 * and could drop orders at the 3-day boundary). Each continuation is
 * itself capped, so a large backlog drains across visible, bounded
 * runs instead of one unbounded sweep. The chain ends when a run's
 * last page reports `hasMore: false`.
 */
export interface ReconcileResume {
  page: number;
  cursor?: string;
  since: string;
  until: string;
}

const RECONCILE_RESUME_KEY = 'reconcileResume';

function readResume(metadata: unknown): ReconcileResume | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const r = (metadata as Record<string, unknown>)[RECONCILE_RESUME_KEY];
  if (!r || typeof r !== 'object') return null;
  const { page, cursor, since, until } = r as Record<string, unknown>;
  if (typeof page !== 'number' || page < 1) return null;
  if (typeof since !== 'string' || typeof until !== 'string') return null;
  const sinceDate = new Date(since);
  const untilDate = new Date(until);
  if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime())) return null;
  return {
    page: Math.floor(page),
    ...(typeof cursor === 'string' && cursor ? { cursor } : {}),
    since,
    until,
  };
}

@Injectable()
export class StoreOrderReconcileService {
  private readonly logger = new Logger(StoreOrderReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly ingest: StoreOrderIngestService,
    private readonly stores: StoresService,
    // SaaS §5.1 — trailing @Optional so specs constructing the service
    // positionally keep working. The enqueue entitlement check is the
    // second layer; this gate stops the tick from minting a SyncRun that
    // no worker will ever finish (live find 2026-11-22: hourly orphaned
    // RUNNING reconcile runs for downgraded tenants).
    @Optional() private readonly entitlements?: TenantEntitlementsService,
  ) {}

  /**
   * Hourly tick: enqueue one bounded reconcile job per connected external
   * store. Heavy work never runs in the caller (BR-21).
   */
  async tickHourly(): Promise<{ enqueued: string[]; excludedNativeCount: number }> {
    if (!reconcileEnabled()) return { enqueued: [], excludedNativeCount: 0 };
    // SaaS §5.1: a tenant whose plan no longer includes order sync gets
    // no reconcile work at all — no run row, no enqueue (the enqueue
    // check is the second layer, but it cannot un-mint a run row).
    if (this.entitlements && !this.entitlements.canUse('store_order_sync')) {
      this.logger.log(
        'reconcile tick skipped: tenant plan lacks store_order_sync',
      );
      return { enqueued: [], excludedNativeCount: 0 };
    }
    const stores = await this.prisma.store.findMany({
      where: { status: 'CONNECTED' as any, autoSyncEnabled: true },
      select: { id: true, kind: true },
    });
    const external = (stores as any[]).filter((s) => s.kind !== 'NATIVE');
    const enqueued: string[] = [];
    for (const store of external) {
      const run = await this.runs.begin({
        scope: 'RECONCILE' as any,
        triggerType: 'SCHEDULED',
        storeId: store.id,
        windowDays: 3,
      });
      const runId = (run as any).id as string;
      await this.queues.enqueue(
        'store-reconcile',
        'order-reconcile',
        { runId, storeId: store.id },
        `order-reconcile:${store.id}:${runId}`,
        // G-14: recovery yields to live webhooks (priority 10).
        { priority: WEBHOOK_PRIORITY.reconciliation },
      );
      enqueued.push(runId);
    }
    return { enqueued, excludedNativeCount: (stores as any[]).length - external.length };
  }

  /**
   * Run one bounded reconcile for a store. Returns run summary; never throws
   * for provider failures (records FAILED + issue instead).
   */
  async runStore(
    storeId: string,
    runId: string,
    opts: ReconcileOptions = {},
  ): Promise<{ created: number; updated: number; skipped: number; failed: number }> {
    const { windowDays, wideningReason } = clampReconcileWindow({
      requestedDays: opts.requestedDays,
      wideningReason: opts.wideningReason,
      wideningEnabled: reconcileWideningEnabled(),
    });
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: { windowDays, wideningReason },
    });

    // P2 continuation: a run begun by a capped predecessor resumes from
    // the exact page/cursor with the ORIGINAL window frozen (see
    // ReconcileResume). An unreadable resume falls back to a fresh
    // window — a resume is an optimization, never a precondition.
    let resume: ReconcileResume | null = null;
    try {
      const runRow = await this.prisma.syncRun.findUnique({
        where: { id: runId },
        select: { metadata: true },
      });
      resume = readResume((runRow as any)?.metadata);
    } catch {
      resume = null;
    }
    const until = resume ? new Date(resume.until) : new Date();
    const since = resume
      ? new Date(resume.since)
      : new Date(until.getTime() - windowDays * 86400000);
    if (resume) {
      this.logger.log(
        `reconcile run ${runId} resuming store ${storeId} at page ${resume.page} (continuation)`,
      );
    }
    const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };

    let provider: Awaited<ReturnType<StoreOrderIngestService['providerFor']>>;
    let withSecrets: { id: string; kind: string; settings?: any; secrets?: any };
    try {
      withSecrets = (await this.stores.storeWithSecrets(storeId)) as any;
      provider = await this.ingest.providerFor(storeId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.runs.upsertIssue({
        storeId,
        code: 'ORDER_RECONCILE_FAILED',
        objectType: 'ORDER',
        objectKey: `store:${storeId}:reconcile`,
        message: `Reconcile cannot start: ${msg}`,
      });
      // Widening is failure-driven (BR-10): a hard provider failure is the
      // signal the operator may widen on — recorded, never automatic.
      if ((windowDays >= 30 || !reconcileWideningEnabled()) && /auth|permission/i.test(msg)) {
        await this.runs.upsertIssue({
          storeId,
          code: 'ORDER_RECONCILE_AT_LIMIT',
          objectType: 'ORDER',
          objectKey: `store:${storeId}:reconcile:limit`,
          message: `Reconcile failing at the widening bound — operator review required (BR-10).`,
        });
      }
      await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 });
      return { ...counts, failed: 1 };
    }

    let page = resume?.page ?? 1;
    let pages = 0;
    let cursor: string | undefined = resume?.cursor;
    let processed = 0;
    let lastHasMore = false;
    let lastCursor: string | undefined;
    try {
      for (;;) {
        pages += 1;
        if (pages > RECONCILE_MAX_PAGES) {
          await this.runs.recordItem(runId, {
            storeId,
            objectType: 'ORDER',
            status: 'SKIPPED',
            reason: `RECONCILE_PAGE_CAP: stopped after ${RECONCILE_MAX_PAGES} pages (${RECONCILE_MAX_ORDERS_PER_RUN} orders, BR-10 bound)`,
            auditLevel: 'G',
          });
          // P2 segmentation: the recovery continues, it does not
          // truncate. When the last fetched page still had more, ONE
          // continuation run resumes from the next page/cursor with
          // the same frozen window (priority 10 — it queues behind
          // live webhooks and other tenants' reconciles, so a big
          // backlog drains fairly instead of monopolizing the
          // worker). The chain ends when a run's last page reports
          // hasMore: false.
          if (lastHasMore) {
            const contReason = `continuation of run ${runId} (page cap reached at page ${page})`;
            try {
              const contRun = await this.runs.begin({
                scope: 'RECONCILE' as any,
                triggerType: 'SCHEDULED',
                storeId,
                windowDays,
                wideningReason: contReason,
                metadata: {
                  [RECONCILE_RESUME_KEY]: {
                    page,
                    ...(lastCursor ? { cursor: lastCursor } : {}),
                    since: since.toISOString(),
                    until: until.toISOString(),
                  } satisfies ReconcileResume,
                },
              });
              const contRunId = (contRun as any).id as string;
              await this.queues.enqueue(
                'store-reconcile',
                'order-reconcile',
                {
                  runId: contRunId,
                  storeId,
                  requestedDays: windowDays,
                  wideningReason: contReason,
                },
                `order-reconcile:${storeId}:${contRunId}`,
                // G-14: a continuation is still recovery (priority 10).
                { priority: WEBHOOK_PRIORITY.reconciliation },
              );
              this.logger.log(
                `reconcile store ${storeId}: page cap hit, continuation run ${contRunId} enqueued from page ${page}`,
              );
            } catch (err) {
              // The hourly tick is still the outer safety net — a
              // failed continuation delays recovery, it does not lose
              // it. Recorded, never thrown (runStore never throws
              // for provider failures; same rule here).
              this.logger.error(
                `reconcile store ${storeId}: continuation enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              await this.runs.upsertIssue({
                storeId,
                code: 'ORDER_RECONCILE_FAILED',
                objectType: 'ORDER',
                objectKey: `store:${storeId}:reconcile:continuation`,
                message: `Reconcile hit the page cap and its continuation could not be enqueued — recovery resumes at the next hourly tick.`,
              });
            }
          }
          break;
        }
        // Rate-limited paging: small delay between pages, bounded page size.
        // Cursor-threaded: page-based providers use `page`, cursor providers
        // (Shopify page_info) use `nextCursor` — both bounded by the cap.
        if (page > 1) await new Promise((r) => setTimeout(r, 400));
        const { orders, hasMore, nextCursor } = await provider.fetchOrders(withSecrets as any, {
          since,
          until,
          page,
          pageSize: RECONCILE_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        // J-10: one shared SKU batch for the whole page (3 queries instead
        // of up to 3 per item per order). Defensive by design: the batch
        // is an optimization, never a precondition — if it is unavailable
        // or throws, per-order ingest resolves SKUs itself (same results).
        // The provider rides the trigger so the G-15 status gate applies
        // (Woo-only) to reconciled orders too.
        const providerSlug = String((withSecrets as any)?.kind ?? '').toLowerCase() || undefined;
        let skuContext: Awaited<ReturnType<StoreOrderIngestService['buildSkuResolutionContext']>> | undefined;
        if (typeof (this.ingest as any).buildSkuResolutionContext === 'function') {
          try {
            const pageSkus: string[] = [];
            for (const raw of orders as Record<string, unknown>[]) {
              for (const item of normalizeOrder(raw).items) {
                if (item.sku) pageSkus.push(item.sku);
              }
            }
            skuContext = await this.ingest.buildSkuResolutionContext(storeId, pageSkus);
          } catch (err) {
            this.logger.warn(
              `reconcile SKU batch failed for store ${storeId} — falling back to per-order resolution: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            skuContext = undefined;
          }
        }
        for (const raw of orders as Record<string, unknown>[]) {
          try {
            const res = await this.ingest.ingest(storeId, raw, {
              type: 'RECONCILE',
              runId,
              actor: opts.actor ?? 'reconcile',
              provider: providerSlug,
              skuContext,
              // Reconcile carve-out (coordinator decision, fix-round-1):
              // reconcile recovers missed real orders — a `completed` order
              // missed during an outage must import, not skip as
              // unimportable. Webhook intake/ingest keep the gate.
              bypassStatusGate: true,
            });
            if (res.created) counts.created += 1;
            else if (res.statusChanged) counts.updated += 1;
            else counts.skipped += 1;
          } catch (err) {
            counts.failed += 1;
            const msg = err instanceof Error ? err.message : String(err);
            await this.runs.recordItem(runId, {
              storeId,
              objectType: 'ORDER',
              status: 'FAILED',
              reason: `RECONCILE_ITEM_FAILED: ${msg}`,
              auditLevel: 'G',
            });
          }
        }
        processed += (orders as unknown[]).length;
        lastHasMore = hasMore;
        lastCursor = nextCursor;
        // P2 segmentation checkpoint: every 10 pages (1,000 orders) a
        // progress item lands on the run so a long recovery is visible
        // in the Sync Center instead of looking stalled. The item is
        // SKIPPED-status detail only — it never touches finish()
        // counts (those come from the summary passed to finish()).
        if (pages % RECONCILE_SEGMENT_PAGES === 0) {
          await this.runs.recordItem(runId, {
            storeId,
            objectType: 'ORDER',
            status: 'SKIPPED',
            reason: `RECONCILE_SEGMENT: pages ${page - RECONCILE_SEGMENT_PAGES + 1}-${page} complete (${processed} orders this run)`,
            auditLevel: 'G',
          });
        }
        if (!hasMore) break;
        cursor = nextCursor;
        page += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      counts.failed += 1;
      await this.runs.upsertIssue({
        storeId,
        code: 'ORDER_RECONCILE_FAILED',
        objectType: 'ORDER',
        objectKey: `store:${storeId}:reconcile`,
        message: `Reconcile failed: ${msg}`,
      });
    }

    await this.runs.finish(runId, counts);
    return counts;
  }
}
