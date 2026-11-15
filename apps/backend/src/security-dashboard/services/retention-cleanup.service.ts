import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventAggregatorService } from './event-aggregator.service';
import { runPerTenant } from '../../tenancy/tenant-job';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';

/**
 * Periodic retention cleanup job.
 * Runs every 6 hours via OnModuleInit interval.
 * Cleans expired SecurityEvent rows and stale aggregates per
 * SecurityRetentionPolicy configuration.
 */
@Injectable()
export class RetentionCleanupService implements OnModuleInit {
  private readonly logger = new Logger(RetentionCleanupService.name);
  private readonly CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

  constructor(
    private readonly aggregator: EventAggregatorService,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly tenantRegistry?: TenantRegistryService,
  ) {}

  onModuleInit() {
    // Run first cleanup after 1 hour (gives system time to start)
    setTimeout(() => this.runCleanup(), 3600_000);
    // Then repeat every 6 hours
    setInterval(() => this.runCleanup(), this.CLEANUP_INTERVAL_MS);
    this.logger.log('Retention cleanup scheduled: every 6 hours');
  }

  private async runCleanup() {
    this.logger.log('Starting periodic retention cleanup...');
    try {
      if (await this.prisma.isRestoreWriteBlocked()) {
        this.logger.debug(
          'Retention cleanup deferred while a restore owns the database',
        );
        return;
      }

      let deleted = 0;
      await runPerTenant(this.tenantRegistry, async () => {
        const result = await this.aggregator.cleanExpiredEvents();
        deleted += result.deleted;
      });
      if (deleted > 0) {
        this.logger.log(`Retention cleanup: ${deleted} events removed`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Retention cleanup failed: ${message}`);
    }
  }

  /**
   * One-shot cleanup (for manual trigger or first deployment).
   */
  async runOnce(): Promise<{ deleted: number }> {
    let deleted = 0;
    await runPerTenant(this.tenantRegistry, async () => {
      const result = await this.aggregator.cleanExpiredEvents();
      deleted += result.deleted;
    });
    return { deleted };
  }
}
