import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailQueueService } from './email-queue.service';
import { EmailQueueProcessor } from './email-queue.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { SmtpSettingsModule } from '../../smtp-settings/smtp-settings.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'email' }),
    PrismaModule,
    SmtpSettingsModule,
  ],
  providers: [EmailQueueService, EmailQueueProcessor],
  exports: [EmailQueueService],
})
export class EmailQueueModule {}
