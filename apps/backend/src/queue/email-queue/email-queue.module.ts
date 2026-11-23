import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailQueueService } from './email-queue.service';
import { EmailQueueProcessor } from './email-queue.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { SmtpSettingsModule } from '../../smtp-settings/smtp-settings.module';
import { processorsEnabled } from '../../common/worker-mode';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'email' }),
    PrismaModule,
    SmtpSettingsModule,
  ],
  providers: [
    EmailQueueService,
    // Worker split (WORKER_MODE): the processor runs only in `worker`/`all`
    // modes. In `api` mode the queue itself (registerQueue above) stays —
    // HTTP paths must still enqueue — but no BullMQ Worker is created.
    ...(processorsEnabled() ? [EmailQueueProcessor] : []),
  ],
  exports: [EmailQueueService],
})
export class EmailQueueModule {}
