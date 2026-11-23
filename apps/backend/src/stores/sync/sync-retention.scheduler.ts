/**
 * Retention purge scheduler — central-commerce P11 (BR-19, §12).
 *
 * Registers the idempotent BullMQ repeatable `retention-purge` (daily,
 * Asia/Dhaka) on `store-maintenance`, following the repo convention
 * (backup/stock-audit/order-reconcile: repeatables owned by Redis, not the
 * process — §3.3). The tick only enqueues; the bounded purge itself runs in
 * `StoreMaintenanceProcessor` (BR-21: heavy work never in the scheduler).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { schedulersEnabled } from '../../common/worker-mode';

export const RETENTION_PURGE_CRON = '30 3 * * *';
export const RETENTION_PURGE_TZ = 'Asia/Dhaka';

@Injectable()
export class SyncRetentionScheduler implements OnModuleInit {
  private readonly logger = new Logger(SyncRetentionScheduler.name);

  constructor(@InjectQueue('store-maintenance') private readonly maintenanceQ: Queue) {}

  async onModuleInit() {
    // Worker split (WORKER_MODE): repeatable registration is scheduler work
    // — the api process owns it. In `worker` mode this process only consumes
    // jobs.
    if (!schedulersEnabled()) {
      this.logger.log(
        'Retention purge scheduler skipped (WORKER_MODE=worker — api owns scheduling)',
      );
      return;
    }
    try {
      const repeats = await this.maintenanceQ.getRepeatableJobs();
      const has = repeats.some((r) => r.name === 'retention-purge');
      if (!has) {
        // SaaS (§3.5): the tick carries { fanOut: true } and NO tenantId —
        // StoreMaintenanceProcessor intercepts it and sweeps ACTIVE
        // tenants inline via runPerTenant.
        await this.maintenanceQ.add(
          'retention-purge',
          { fanOut: true },
          {
            repeat: { pattern: RETENTION_PURGE_CRON, tz: RETENTION_PURGE_TZ },
            removeOnComplete: 20,
            removeOnFail: 20,
          },
        );
        this.logger.log('registered daily retention-purge (Asia/Dhaka)');
      }
    } catch (err) {
      // Redis unavailable in unit-test context — the purge simply doesn't tick.
      this.logger.warn(`retention purge scheduler not registered: ${err}`);
    }
  }
}
