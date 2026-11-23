import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ObservabilityModule } from '../observability/observability.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupService } from './backup.service';
import { BackupJobProcessor } from './backup-job.processor';
import { StorageService } from '../storage/storage.service';
import { processorsEnabled } from '../common/worker-mode';

/**
 * Backups are a platform/ops-only job. There is intentionally NO controller
 * in this module: the old tenant-facing `POST /admin/backup` (and its
 * restore/download siblings) dumped and restored the ENTIRE shared
 * database with no tenant filter, so any tenant superadmin could dump
 * every tenant's data. The service stays exported for the ops paths that
 * remain: scheduled backups (repeatable BullMQ job, registered in
 * BackupService.onModuleInit), internal triggers such as the
 * reconciliation safety backup, and the queue processor.
 *
 * A future platform/ops HTTP surface for backups must live behind the
 * platform internal-service guard — never behind a tenant role.
 */
@Module({
  imports: [
    PrismaModule,
    ObservabilityModule,
    BullModule.registerQueue(
      { name: 'backup' },
      { name: 'email' },
      { name: 'import' },
      { name: 'tracking' },
      { name: 'security-events' },
      { name: 'security-aggregate' },
    ),
  ],
  providers: [
    BackupService,
    // Worker split (WORKER_MODE): the processor runs only in `worker`/`all`
    // modes. In `api` mode the queue itself (registerQueue above) stays —
    // HTTP paths must still enqueue — but no BullMQ Worker is created.
    ...(processorsEnabled() ? [BackupJobProcessor] : []),
    StorageService,
  ],
  exports: [BackupService],
})
export class BackupModule {}
