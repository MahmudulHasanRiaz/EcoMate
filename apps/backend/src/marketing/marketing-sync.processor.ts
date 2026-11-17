import { Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Optional } from '@nestjs/common';
import { MarketingSyncService } from './marketing-sync.service';
import { MARKETING_QUEUE } from './marketing.constants';
import {
  runPerTenant,
  tenantJobPayload,
  TenantJobData,
  TenantWorkerHost,
} from '../tenancy/tenant-job';
import { TenantRegistryService } from '../tenancy/tenant-registry.service';

export interface MarketingJob extends TenantJobData {
  type: 'sync-all' | 'sync-account';
  adAccountId?: string;
  forceInsights?: boolean;
}

@Processor(MARKETING_QUEUE)
export class MarketingSyncProcessor extends TenantWorkerHost<MarketingJob> {
  constructor(
    private readonly sync: MarketingSyncService,
    // Plain parameter (not a property): the base class owns the
    // `tenantRegistry` property; `this.tenantRegistry` below resolves to it.
    @Optional()
    tenantRegistry?: TenantRegistryService,
  ) {
    super(tenantRegistry);
  }

  async process(job: Job<MarketingJob>): Promise<any> {
    // The repeatable system job has no tenant; run the sweep once per tenant.
    if (job.data.type === 'sync-all' && !job.data.tenantId) {
      const results: any[] = [];
      await runPerTenant(this.tenantRegistry, async () => {
        results.push(...(await this.sync.syncAll(job.data.forceInsights)));
      });
      return results;
    }
    // Return the base result: the skip marker ({ skipped: ... }) is the
    // job's returnvalue, and BullMQ only records what process() returns.
    return super.process(job);
  }

  protected async handle(job: Job<MarketingJob>): Promise<any> {
    if (job.data.type === 'sync-account' && job.data.adAccountId) {
      return this.sync.syncAdAccount(job.data.adAccountId, job.data.forceInsights);
    }
    return this.sync.syncAll(job.data.forceInsights);
  }
}

export async function enqueueMarketingSync(
  queue: Queue<MarketingJob, any, string>,
  payload: Omit<MarketingJob, 'tenantId' | 'tenantSlug'>,
  jobId?: string,
) {
  return queue.add(payload.type, tenantJobPayload(payload), {
    ...(jobId ? { jobId } : {}),
    attempts: 2,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: 200,
    removeOnFail: 100,
  });
}