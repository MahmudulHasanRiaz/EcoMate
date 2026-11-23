/**
 * Hourly webhook-health check — central-commerce P6 webhook lifecycle
 * (G-05/G-06).
 *
 * Registers the idempotent BullMQ repeatable `webhook-health-tick`
 * (hourly, Asia/Dhaka) on `store-maintenance`, following the repo
 * convention (backup/stock-audit/order-reconcile/retention-purge:
 * repeatables owned by Redis, not the process — §3.3). The tick only
 * enqueues; the sweep itself runs in `StoreMaintenanceProcessor`
 * (BR-21: heavy work never in the scheduler), which fans out per tenant
 * and calls `checkTenantStores()` inside each tenant's context.
 *
 * Per CONNECTED store the sweep re-runs the provider ensure — which
 * heals duplicates, stale URLs and disabled/paused hooks — and records a
 * RESOLVED issue row when it heals anything (visible history, not an
 * alarming OPEN issue). Failures are recorded by the ensure's own
 * best-effort path (OPEN `WEBHOOK_ENSURE_FAILED` issue + log).
 *
 * The healed-issue row is written directly via Prisma instead of
 * `SyncRunService.upsertIssue`: upsertIssue also reports the message as
 * the console's `lastError`, which would mislabel a successful heal as
 * an error. The direct write mirrors its compact-state shape (one row
 * per store, occurrences incremented) with status RESOLVED from birth.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { schedulersEnabled } from '../../common/worker-mode';
import { PrismaService } from '../../prisma/prisma.service';
import { StoresService, WEBHOOK_HEALED_CODE } from '../stores.service';
import { resolveWebhookCallbackBase } from './webhook-callback-base';

export const WEBHOOK_HEALTH_TICK = 'webhook-health-tick';
/** Hourly at :15 — offset from the :00 reconcile tick to spread load. */
export const WEBHOOK_HEALTH_CRON = '15 * * * *';
export const WEBHOOK_HEALTH_TZ = 'Asia/Dhaka';

export interface WebhookHealthSweepResult {
  checked: number;
  healed: number;
  failed: number;
  skipped: boolean;
}

@Injectable()
export class WebhookHealthScheduler implements OnModuleInit {
  private readonly logger = new Logger(WebhookHealthScheduler.name);

  constructor(
    @InjectQueue('store-maintenance') private readonly maintenanceQ: Queue,
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  async onModuleInit() {
    // Worker split (WORKER_MODE): repeatable registration is scheduler work
    // — the api process owns it. In `worker` mode this process only consumes
    // jobs. The class itself STAYS registered in every mode: it is
    // @Optional-injected by StoreMaintenanceProcessor, which calls
    // checkTenantStores() from the worker process.
    if (!schedulersEnabled()) {
      this.logger.log(
        'Webhook health scheduler skipped (WORKER_MODE=worker — api owns scheduling)',
      );
      return;
    }
    try {
      const repeats = await this.maintenanceQ.getRepeatableJobs();
      const has = repeats.some((r) => r.name === WEBHOOK_HEALTH_TICK);
      if (!has) {
        // SaaS (§3.5): the tick carries { fanOut: true } and NO tenantId —
        // StoreMaintenanceProcessor intercepts it and sweeps ACTIVE
        // tenants inline via runPerTenant.
        await this.maintenanceQ.add(
          WEBHOOK_HEALTH_TICK,
          { fanOut: true },
          {
            repeat: { pattern: WEBHOOK_HEALTH_CRON, tz: WEBHOOK_HEALTH_TZ },
            removeOnComplete: 20,
            removeOnFail: 20,
          },
        );
        this.logger.log('registered hourly webhook-health-tick (Asia/Dhaka)');
      }
    } catch (err) {
      // Redis unavailable in unit-test context — the tick simply doesn't run.
      this.logger.warn(`webhook health scheduler not registered: ${err}`);
    }
  }

  /**
   * Sweep one tenant's CONNECTED stores (called inside the tenant's
   * context by the maintenance processor). Returns the sweep counts.
   * Never throws — per-store failures are counted + logged, and a missing
   * PUBLIC_API_BASE_URL skips the whole sweep with one warning instead of
   * one failure per store.
   */
  async checkTenantStores(): Promise<WebhookHealthSweepResult> {
    try {
      resolveWebhookCallbackBase();
    } catch {
      this.logger.warn(
        'webhook health check skipped: PUBLIC_API_BASE_URL is not configured (no webhook can be registered until it is set)',
      );
      return { checked: 0, healed: 0, failed: 0, skipped: true };
    }
    const stores = await this.prisma.store.findMany({
      where: { status: 'CONNECTED', kind: { not: 'NATIVE' } },
      select: { id: true },
    });
    let healed = 0;
    let failed = 0;
    for (const store of stores) {
      try {
        // ensureSecret: true — a legacy store connected before the
        // lifecycle work gets its secret generated here, then its hooks.
        const outcome = await this.stores.ensureStoreWebhooksBestEffort(store.id, {
          ensureSecret: true,
        });
        if (outcome.status === 'failed') {
          failed += 1;
          continue;
        }
        const didHeal = outcome.recreated.length > 0 || outcome.deleted > 0;
        if (didHeal) {
          healed += 1;
          this.logger.log(
            `webhook health healed store ${store.id} (recreated ${outcome.recreated.join(', ') || 'none'}, deleted ${outcome.deleted})`,
          );
          await this.recordHealed(store.id, outcome.recreated, outcome.deleted);
        }
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `webhook health check failed for store ${store.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { checked: stores.length, healed, failed, skipped: false };
  }

  /** Compact-state RESOLVED row for a heal (see the file docblock). */
  private async recordHealed(storeId: string, recreated: string[], deleted: number): Promise<void> {
    const message =
      `Webhook health check healed this store (recreated: ${recreated.join(', ') || 'none'}; hooks deleted: ${deleted}).`;
    try {
      const existing = await this.prisma.storeSyncIssue.findUnique({
        where: {
          storeId_code_objectKey: {
            storeId,
            code: WEBHOOK_HEALED_CODE,
            objectKey: 'webhook-heal',
          },
        },
      });
      if (existing) {
        await this.prisma.storeSyncIssue.update({
          where: { id: existing.id },
          data: {
            occurrences: { increment: 1 },
            message,
            status: 'RESOLVED' as any,
            resolvedAt: new Date(),
            resolveNote: 'Auto-healed by the hourly webhook health check.',
          },
        });
      } else {
        await this.prisma.storeSyncIssue.create({
          data: {
            storeId,
            code: WEBHOOK_HEALED_CODE,
            objectType: 'ORDER' as any,
            objectKey: 'webhook-heal',
            message,
            status: 'RESOLVED' as any,
            resolvedAt: new Date(),
            resolveNote: 'Auto-healed by the hourly webhook health check.',
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `webhook healed-issue row failed for store ${storeId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
