import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ImportJob } from './import-queue.service';
import { TenantWorkerHost } from '../../tenancy/tenant-job';

@Processor('import')
export class ImportQueueProcessor extends TenantWorkerHost<ImportJob> {
  protected async handle(job: Job<ImportJob>): Promise<void> {
    console.log(
      `[ImportQueue] Processing ${job.data.type} import for user ${job.data.userId}`,
    );
  }
}
