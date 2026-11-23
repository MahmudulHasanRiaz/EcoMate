import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageService } from '../../storage/storage.service';
import { MediaQueueService } from './media-queue.service';
import { MediaQueueProcessor } from './media-queue.processor';
import { processorsEnabled } from '../../common/worker-mode';

@Module({
  imports: [BullModule.registerQueue({ name: 'media' }), PrismaModule],
  providers: [
    MediaQueueService,
    // Worker split (WORKER_MODE): the processor runs only in `worker`/`all`
    // modes. In `api` mode the queue itself (registerQueue above) stays —
    // HTTP paths must still enqueue — but no BullMQ Worker is created.
    ...(processorsEnabled() ? [MediaQueueProcessor] : []),
    StorageService,
  ],
  exports: [MediaQueueService],
})
export class MediaQueueModule {}
