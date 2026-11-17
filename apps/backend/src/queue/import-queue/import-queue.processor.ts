import { Processor } from '@nestjs/bullmq';
import { Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImportJob } from './import-queue.service';
import { TenantWorkerHost } from '../../tenancy/tenant-job';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';

@Processor('import')
export class ImportQueueProcessor extends TenantWorkerHost<ImportJob> {
  constructor(@Optional() tenantRegistry?: TenantRegistryService) {
    super(tenantRegistry);
  }
  protected async handle(job: Job<ImportJob>): Promise<void> {
    console.log(
      `[ImportQueue] Processing ${job.data.type} import for user ${job.data.userId}`,
    );
  }
}
