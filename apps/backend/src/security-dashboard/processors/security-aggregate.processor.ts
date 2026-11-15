import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EventAggregatorService } from '../services/event-aggregator.service';
import { runPerTenant } from '../../tenancy/tenant-job';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';

/**
 * Previously the `security-aggregate` queue had no worker, so recalculation
 * jobs accumulated forever. This system job fans the fallback recalculation
 * out across active tenants; the aggregator itself is idempotent.
 */
@Processor('security-aggregate')
export class SecurityAggregateProcessor extends WorkerHost {
  private readonly logger = new Logger(SecurityAggregateProcessor.name);

  constructor(
    private readonly aggregator: EventAggregatorService,
    @Optional()
    private readonly tenantRegistry?: TenantRegistryService,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    const hourlyFrom = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const dailyFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const result = await runPerTenant(this.tenantRegistry, async () => {
      await this.aggregator.recalculateHourly(hourlyFrom, now);
      await this.aggregator.recalculateDaily(dailyFrom, now);
    });

    if (result.failed > 0) {
      this.logger.warn(
        `Security aggregate recalculation failed for ${result.failed} tenant(s)`,
      );
    }
  }
}
