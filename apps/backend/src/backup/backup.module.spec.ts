import { BackupModule } from './backup.module';
import { BackupService } from './backup.service';

/**
 * Phase 8 (D5): the tenant-facing backup/restore HTTP surface was removed
 * because it dumped and restored the ENTIRE shared database with no tenant
 * filter. These specs lock in both halves of that change:
 *   1. BackupModule registers no controllers (no tenant user can trigger
 *      a full shared-DB dump/restore over HTTP any more).
 *   2. The ops path still works — BackupService.triggerManual (used by
 *      scheduled backups and internal triggers such as the reconciliation
 *      safety backup) still creates a job and enqueues it.
 */
describe('BackupModule (tenant backup fencing)', () => {
  it('registers no controllers', () => {
    const controllers: unknown[] | undefined = Reflect.getMetadata(
      'controllers',
      BackupModule,
    );
    expect(controllers ?? []).toEqual([]);
  });

  it('still exports BackupService for the ops paths', () => {
    const providers: unknown[] | undefined = Reflect.getMetadata(
      'providers',
      BackupModule,
    );
    expect(providers ?? []).toContain(BackupService);
  });

  it('triggerManual still creates and enqueues a backup job', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      backupJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'backup-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
      backupJob: tx.backupJob,
    } as any;
    const backupQueue = { add: jest.fn().mockResolvedValue({}) } as any;
    const service = new BackupService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      backupQueue,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.triggerManual('db_only');

    expect(result).toEqual({ id: 'backup-1' });
    expect(tx.backupJob.create).toHaveBeenCalledWith({
      data: { type: 'manual', scope: 'db_only', status: 'pending' },
    });
    expect(backupQueue.add).toHaveBeenCalledWith(
      'backup',
      { backupId: 'backup-1' },
      expect.objectContaining({ jobId: 'backup-backup-1' }),
    );
  });
});
