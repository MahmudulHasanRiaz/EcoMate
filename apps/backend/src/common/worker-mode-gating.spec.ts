/**
 * Mode-gating proof — worker split, workstream E.
 *
 * Part 1 (behavioural): the scheduler bootstrap hooks early-return in
 * `worker` mode and run in `api`/`all` mode. Services are constructed with
 * mocks; no DB, no Redis.
 *
 * Part 2 (registration): in `api` mode the @Processor providers are absent
 * from their modules' @Module metadata, so @nestjs/bullmq never creates a
 * BullMQ Worker for them; in `worker`/`all` they are present. Module files
 * are re-required per mode under jest.resetModules() because @Module
 * metadata is evaluated at import time.
 *
 * The stores processors/schedulers (stores.module.ts) ARE covered here
 * since fix-round-1 (see webhook-build-verify/E-worker/stores-module-patch.md):
 * the 8 processors join the Part 2 CASES table and the 4 scheduler guards
 * get Part 1 behavioural cases below.
 */
import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { QueueWatcherService } from '../observability/queue-watcher.service';
import { MediaQueueService } from '../media/media-queue/media-queue.service';
import { OutboxRelayService } from '../tracking/outbox-relay.service';
import { ReconcilerService } from '../tracking/reconciler.service';
import { BackupService } from '../backup/backup.service';
import { MarketingModule } from '../marketing/marketing.module';
import { AuthService } from '../auth/auth.service';
import { BlockedEntriesService } from '../blocked-entries/blocked-entries.service';
import { WebhookAttemptService } from '../courier-manager/webhook-attempt.service';
import { RetentionCleanupService as SecurityRetentionCleanupService } from '../security-dashboard/services/retention-cleanup.service';
import { RetentionCleanupService as TrackingRetentionCleanupService } from '../tracking/retention-cleanup.service';
import { StoreOrderScheduler } from '../stores/orders/store-order-scheduler';
import { SyncRetentionScheduler } from '../stores/sync/sync-retention.scheduler';
import { WebhookHealthScheduler } from '../stores/webhooks/webhook-health.scheduler';
import { StockStatusSyncService } from '../stores/sync/stock-status-sync.service';

function setMode(mode: string | undefined) {
  if (mode === undefined) delete process.env.WORKER_MODE;
  else process.env.WORKER_MODE = mode;
}

describe('scheduler bootstrap guards (worker mode skips, api mode runs)', () => {
  const prev = process.env.WORKER_MODE;

  afterEach(() => {
    setMode(prev);
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('QueueWatcher: no timer in worker mode, timer in api mode', () => {
    setMode('worker');
    const workerWatcher = new QueueWatcherService();
    workerWatcher.onModuleInit();
    expect((workerWatcher as any).timer).toBeNull();

    setMode('api');
    const apiWatcher = new QueueWatcherService();
    apiWatcher.onModuleInit();
    expect((apiWatcher as any).timer).not.toBeNull();
    apiWatcher.onModuleDestroy();
  });

  it('MediaQueueService: onModuleInit is a no-op in worker mode (no queue/DB touch)', async () => {
    setMode('worker');
    // Empty mocks: ANY queue/prisma/cache access would throw. The guard
    // must return before the first one.
    const service = new MediaQueueService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('OutboxRelay: no poll loop in worker mode, loop in api mode', async () => {
    const settings = { get: jest.fn().mockResolvedValue('true') };
    setMode('worker');
    const workerRelay = new OutboxRelayService(
      {} as any,
      {} as any,
      settings as any,
    );
    await workerRelay.onModuleInit();
    expect((workerRelay as any).timer).toBeNull();
    expect(settings.get).not.toHaveBeenCalled();

    setMode('api');
    const apiRelay = new OutboxRelayService(
      {} as any,
      {} as any,
      settings as any,
    );
    await apiRelay.onModuleInit();
    expect((apiRelay as any).timer).not.toBeNull();
    await apiRelay.stop();
  });

  it('Reconciler: no loop in worker mode, loop in api mode', async () => {
    setMode('worker');
    const workerReconciler = new ReconcilerService({} as any);
    await workerReconciler.onModuleInit();
    expect((workerReconciler as any).timer).toBeNull();

    setMode('api');
    const apiReconciler = new ReconcilerService({} as any);
    await apiReconciler.onModuleInit();
    expect((apiReconciler as any).timer).not.toBeNull();
    await apiReconciler.stop();
  });

  it('BackupService: no repeatable registration in worker mode', async () => {
    setMode('worker');
    const backupQueue = { add: jest.fn() };
    const service = new BackupService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      backupQueue as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await service.onModuleInit();
    expect(backupQueue.add).not.toHaveBeenCalled();
  });

  it('MarketingModule: no sync enqueue in worker mode, enqueued in api mode', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      systemSetting: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const platforms = { ensureDefaults: jest.fn().mockResolvedValue(undefined) };

    setMode('worker');
    const workerModule = new MarketingModule(
      queue as any,
      prisma as any,
      platforms as any,
    );
    await workerModule.onApplicationBootstrap();
    expect(platforms.ensureDefaults).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();

    setMode('api');
    jest.clearAllMocks();
    const apiModule = new MarketingModule(
      queue as any,
      prisma as any,
      platforms as any,
    );
    await apiModule.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'sync-all',
      expect.anything(),
      expect.objectContaining({ jobId: 'marketing-sync-immediate' }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'sync-all',
      expect.anything(),
      expect.objectContaining({ jobId: 'marketing-sync-repeat' }),
    );
  });

  // Cleanup sweeps (replacement builder E): the five idempotent
  // setInterval/setTimeout sweeps are scheduler work too — the api process
  // owns them. Timers are observed via spies with a stubbed implementation
  // (no real timer is ever created, so nothing leaks between tests).
  function timerSpies() {
    const interval = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(() => 123 as unknown as NodeJS.Timeout);
    const timeout = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(() => 456 as unknown as NodeJS.Timeout);
    return { interval, timeout };
  }

  it('AuthService: no token sweep in worker mode, sweep + timer in api mode', async () => {
    const { interval } = timerSpies();
    setMode('worker');
    // Empty mocks: ANY prisma access would throw. The guard must return
    // before cleanupExpiredTokens runs.
    const workerAuth = new AuthService({} as any, {} as any, {} as any);
    await workerAuth.onModuleInit();
    expect(interval).not.toHaveBeenCalled();

    setMode('api');
    const prisma = {
      isRestoreWriteBlocked: jest.fn().mockResolvedValue(false),
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const apiAuth = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
    );
    await apiAuth.onModuleInit();
    expect(interval).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
    apiAuth.onModuleDestroy();
  });

  it('BlockedEntriesService: no expire sweep in worker mode, timer in api mode', () => {
    const { interval } = timerSpies();
    setMode('worker');
    const workerService = new BlockedEntriesService({} as any);
    workerService.onModuleInit();
    expect(interval).not.toHaveBeenCalled();

    setMode('api');
    const apiService = new BlockedEntriesService({} as any);
    apiService.onModuleInit();
    expect(interval).toHaveBeenCalledTimes(1);
    apiService.onModuleDestroy();
  });

  it('WebhookAttemptService: no cleanup timers in worker mode, both in api mode', () => {
    const { interval, timeout } = timerSpies();
    setMode('worker');
    const workerService = new WebhookAttemptService({} as any);
    workerService.onModuleInit();
    expect(interval).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();

    setMode('api');
    const apiService = new WebhookAttemptService({} as any);
    apiService.onModuleInit();
    expect(interval).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledTimes(1);
    void apiService.onModuleDestroy();
  });

  it('Security RetentionCleanupService: no cleanup timers in worker mode, both in api mode', () => {
    const { interval, timeout } = timerSpies();
    setMode('worker');
    const workerService = new SecurityRetentionCleanupService(
      {} as any,
      {} as any,
    );
    workerService.onModuleInit();
    expect(interval).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();

    setMode('api');
    const apiService = new SecurityRetentionCleanupService({} as any, {} as any);
    apiService.onModuleInit();
    expect(interval).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it('Tracking RetentionCleanupService: no sweep in worker mode, loop in api mode', async () => {
    const { interval } = timerSpies();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    setMode('worker');
    // Empty prisma: ANY sweep access would throw. The guard must return
    // before start() and before the boot runCleanup().
    const workerService = new TrackingRetentionCleanupService(
      {} as any,
      config as any,
    );
    await workerService.onModuleInit();
    expect(interval).not.toHaveBeenCalled();
    expect((workerService as any).timer).toBeNull();

    setMode('api');
    const apiService = new TrackingRetentionCleanupService(
      {} as any,
      config as any,
    );
    // The boot runCleanup fails against the empty prisma mock but is
    // swallowed by onModuleInit's own .catch — the observable is the loop.
    await apiService.onModuleInit();
    expect(interval).toHaveBeenCalledTimes(1);
    await apiService.stop();
  });

  // Stores schedulers (fix-round-1 stores patch): the four repeatable
  // registrations in StoresModule are scheduler work — the api process
  // owns them. The classes STAY registered in every mode (the health
  // scheduler is @Optional-injected by StoreMaintenanceProcessor, the
  // stock service is exported + used by HTTP paths); only the bootstrap
  // hook is gated.
  function repeatableQueue() {
    return {
      add: jest.fn().mockResolvedValue(undefined),
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('StoreOrderScheduler: no repeatable in worker mode, hourly tick in api mode', async () => {
    const workerQueue = repeatableQueue();
    setMode('worker');
    await new StoreOrderScheduler(workerQueue as any).onModuleInit();
    expect(workerQueue.getRepeatableJobs).not.toHaveBeenCalled();
    expect(workerQueue.add).not.toHaveBeenCalled();

    const apiQueue = repeatableQueue();
    setMode('api');
    await new StoreOrderScheduler(apiQueue as any).onModuleInit();
    expect(apiQueue.add).toHaveBeenCalledWith(
      'order-reconcile-tick',
      { fanOut: true },
      expect.objectContaining({
        repeat: expect.objectContaining({ pattern: '0 * * * *' }),
      }),
    );
  });

  it('SyncRetentionScheduler: no repeatable in worker mode, daily purge in api mode', async () => {
    const workerQueue = repeatableQueue();
    setMode('worker');
    await new SyncRetentionScheduler(workerQueue as any).onModuleInit();
    expect(workerQueue.getRepeatableJobs).not.toHaveBeenCalled();
    expect(workerQueue.add).not.toHaveBeenCalled();

    const apiQueue = repeatableQueue();
    setMode('api');
    await new SyncRetentionScheduler(apiQueue as any).onModuleInit();
    expect(apiQueue.add).toHaveBeenCalledWith(
      'retention-purge',
      { fanOut: true },
      expect.objectContaining({ repeat: expect.anything() }),
    );
  });

  it('WebhookHealthScheduler: no repeatable in worker mode, hourly tick in api mode', async () => {
    const workerQueue = repeatableQueue();
    setMode('worker');
    await new WebhookHealthScheduler(
      workerQueue as any,
      {} as any,
      {} as any,
    ).onModuleInit();
    expect(workerQueue.getRepeatableJobs).not.toHaveBeenCalled();
    expect(workerQueue.add).not.toHaveBeenCalled();

    const apiQueue = repeatableQueue();
    setMode('api');
    await new WebhookHealthScheduler(
      apiQueue as any,
      {} as any,
      {} as any,
    ).onModuleInit();
    expect(apiQueue.add).toHaveBeenCalledWith(
      'webhook-health-tick',
      { fanOut: true },
      expect.objectContaining({ repeat: expect.anything() }),
    );
  });

  it('StockStatusSyncService: no repeatable touch in worker mode, stock-audit in api mode', async () => {
    const workerQueue = repeatableQueue();
    setMode('worker');
    const workerSvc = new StockStatusSyncService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      workerQueue as any,
    );
    await workerSvc.onModuleInit();
    // The guard sits BEFORE the flag-off removal branch: in worker mode
    // the process neither registers nor removes repeatables.
    expect(workerQueue.getRepeatableJobs).not.toHaveBeenCalled();
    expect(workerQueue.add).not.toHaveBeenCalled();
    expect(workerQueue.removeRepeatableByKey).not.toHaveBeenCalled();

    // stockAuditEnabled() defaults ON (only an explicit 'false' disables);
    // pin the flags to their defaults so the api half is hermetic.
    const flagKeys = [
      'THIRD_PARTY_STORES_ENABLED',
      'store_sync_enabled',
      'store_stock_audit_enabled',
    ] as const;
    const prevFlags = flagKeys.map((k) => process.env[k]);
    for (const k of flagKeys) delete process.env[k];
    try {
      const apiQueue = repeatableQueue();
      setMode('api');
      const apiSvc = new StockStatusSyncService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        apiQueue as any,
      );
      await apiSvc.onModuleInit();
      expect(apiQueue.add).toHaveBeenCalledWith(
        'stock-audit',
        { fanOut: true },
        expect.objectContaining({ repeat: expect.anything() }),
      );
    } finally {
      flagKeys.forEach((k, i) => {
        if (prevFlags[i] === undefined) delete process.env[k];
        else process.env[k] = prevFlags[i];
      });
    }
  });
});

describe('processor registration by mode (@Module metadata)', () => {
  const prev = process.env.WORKER_MODE;

  afterEach(() => {
    setMode(prev);
  });

  const CASES: Array<{
    modulePath: string;
    moduleExport: string;
    processors: string[];
    /** A non-processor provider that must survive in every mode. */
    survivor: string;
  }> = [
    {
      modulePath: '../backup/backup.module',
      moduleExport: 'BackupModule',
      processors: ['BackupJobProcessor'],
      survivor: 'BackupService',
    },
    {
      modulePath: '../courier-settlement/courier-settlement.module',
      moduleExport: 'CourierSettlementModule',
      processors: ['CourierSettlementImportProcessor'],
      survivor: 'CourierSettlementImportService',
    },
    {
      modulePath: '../marketing/marketing.module',
      moduleExport: 'MarketingModule',
      processors: ['MarketingSyncProcessor'],
      survivor: 'MarketingSyncService',
    },
    {
      modulePath: '../media/media-queue/media-queue.module',
      moduleExport: 'MediaQueueModule',
      processors: ['MediaQueueProcessor'],
      survivor: 'MediaQueueService',
    },
    {
      modulePath: '../queue/email-queue/email-queue.module',
      moduleExport: 'EmailQueueModule',
      processors: ['EmailQueueProcessor'],
      survivor: 'EmailQueueService',
    },
    {
      modulePath: '../queue/import-queue/import-queue.module',
      moduleExport: 'ImportQueueModule',
      processors: ['ImportQueueProcessor'],
      survivor: 'ImportQueueService',
    },
    {
      modulePath: '../security-dashboard/security-dashboard.module',
      moduleExport: 'SecurityDashboardModule',
      processors: ['SecurityEventProcessor', 'SecurityAggregateProcessor'],
      survivor: 'SecurityEventEmitterService',
    },
    {
      modulePath: '../tracking/tracking.module',
      moduleExport: 'TrackingModule',
      processors: ['TrackingDispatcherProcessor'],
      survivor: 'TrackingDispatcherService',
    },
    {
      modulePath: '../stores/stores.module',
      moduleExport: 'StoresModule',
      processors: [
        'StoreProductSyncProcessor',
        'StoreStockSyncProcessor',
        'StoreOrderIngestProcessor',
        'StoreOrderPushProcessor',
        'StoreReconcileProcessor',
        'StoreMaintenanceProcessor',
        'StoreProductImportProcessor',
        'StoreProductImportImagesProcessor',
      ],
      survivor: 'StoresService',
    },
  ];

  function providerNames(
    modulePath: string,
    moduleExport: string,
  ): string[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(modulePath);
    const providers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      mod[moduleExport],
    );
    return (providers ?? []).map((p) =>
      typeof p === 'function' ? p.name : String((p as any)?.provide ?? p),
    );
  }

  it.each(CASES)(
    '$moduleExport: processors ABSENT in api mode, survivor present',
    ({ modulePath, moduleExport, processors, survivor }) => {
      setMode('api');
      jest.resetModules();
      const names = providerNames(modulePath, moduleExport);
      for (const processor of processors) {
        expect(names).not.toContain(processor);
      }
      expect(names).toContain(survivor);
    },
  );

  it.each(CASES)(
    '$moduleExport: processors PRESENT in worker mode',
    ({ modulePath, moduleExport, processors }) => {
      setMode('worker');
      jest.resetModules();
      const names = providerNames(modulePath, moduleExport);
      for (const processor of processors) {
        expect(names).toContain(processor);
      }
    },
  );

  it.each(CASES)(
    '$moduleExport: processors PRESENT when WORKER_MODE is unset (default all)',
    ({ modulePath, moduleExport, processors }) => {
      setMode(undefined);
      jest.resetModules();
      const names = providerNames(modulePath, moduleExport);
      for (const processor of processors) {
        expect(names).toContain(processor);
      }
    },
  );
});
