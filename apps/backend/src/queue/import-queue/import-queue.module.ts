import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImportQueueService } from './import-queue.service';
import { ImportQueueProcessor } from './import-queue.processor';
import { processorsEnabled } from '../../common/worker-mode';

@Module({
  imports: [BullModule.registerQueue({ name: 'import' })],
  providers: [
    ImportQueueService,
    // Worker split (WORKER_MODE): the processor runs only in `worker`/`all`
    // modes. In `api` mode the queue itself (registerQueue above) stays —
    // HTTP paths must still enqueue — but no BullMQ Worker is created.
    ...(processorsEnabled() ? [ImportQueueProcessor] : []),
  ],
  exports: [ImportQueueService],
})
export class ImportQueueModule {}
