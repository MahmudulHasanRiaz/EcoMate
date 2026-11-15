import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  DispatchJob,
  TrackingDispatcherService,
} from './tracking-dispatcher.service';
import { TenantWorkerHost } from '../tenancy/tenant-job';

/**
 * BullMQ worker for the `tracking` queue. Each job is an outbox relay claim —
 * `{ snapshotId, outboxId, attemptCount }` — handed to the dispatcher, which
 * resolves the snapshot + context and drives every provider adapter independently.
 */
@Processor('tracking')
export class TrackingDispatcherProcessor extends TenantWorkerHost<DispatchJob> {
  constructor(private readonly dispatcher: TrackingDispatcherService) {
    super();
  }

  protected async handle(job: Job<DispatchJob>): Promise<void> {
    await this.dispatcher.process(job.data, job.id?.toString());
  }
}
