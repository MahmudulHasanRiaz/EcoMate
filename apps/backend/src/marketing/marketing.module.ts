import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { MarketingPlatformsService } from './marketing-platforms.service';
import { MarketingConnectionsService } from './marketing-connections.service';
import { MarketingSyncService } from './marketing-sync.service';
import { MarketingConsumptionService } from './marketing-consumption.service';
import { MarketingAllocationService } from './marketing-allocation.service';
import { MarketingFundingService } from './marketing-funding.service';
import { MarketingAttributionService } from './marketing-attribution.service';
import { MarketingAnalysisService } from './marketing-analysis.service';
import { MarketingSnapshotService } from './marketing-snapshot.service';
import { MarketingPaymentService } from './marketing-payment.service';
import { MetaGraphService } from './meta-graph.service';
import { MetaProviderAdapter } from './meta-provider.adapter';
import { ProviderAdapterFactory } from './provider-factory';
import { AdProviderAdapter, AD_PROVIDER_ADAPTER } from './ad-provider.adapter';
import { MarketingSyncProcessor } from './marketing-sync.processor';
import { MarketingController } from './marketing.controller';
import { MarketingFundingController } from './marketing-funding.controller';
import { MarketingAnalysisController } from './marketing-analysis.controller';
import { MarketingSnapshotController } from './marketing-snapshot.controller';
import { MarketingCaptureController } from './marketing-capture.controller';
import { MarketingWebhooksController } from './marketing-webhooks.controller';
import { MarketingPaymentController } from './marketing-payment.controller';
import { MARKETING_QUEUE, DEFAULT_SYNC_INTERVAL_HOURS, SYNC_INTERVAL_SETTING } from './marketing.constants';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/utils/encryption';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { processorsEnabled, schedulersEnabled } from '../common/worker-mode';

@Module({
  imports: [
    PrismaModule,
    AccountingModule,
    BullModule.registerQueue({ name: MARKETING_QUEUE }),
  ],
  controllers: [
    MarketingController,
    MarketingFundingController,
    MarketingAnalysisController,
    MarketingSnapshotController,
    MarketingCaptureController,
    MarketingWebhooksController,
    MarketingPaymentController,
  ],
  providers: [
    MarketingPlatformsService,
    MarketingConnectionsService,
    MarketingSyncService,
    MarketingConsumptionService,
    MarketingAllocationService,
    MarketingFundingService,
    MarketingAttributionService,
    MarketingAnalysisService,
    MarketingSnapshotService,
    MarketingPaymentService,
    MetaGraphService,
    MetaProviderAdapter,
    { provide: AD_PROVIDER_ADAPTER, useClass: MetaProviderAdapter },
    ProviderAdapterFactory,
    EncryptionService,
    // Worker split (WORKER_MODE): the processor runs only in `worker`/`all`
    // modes. In `api` mode the queue itself (registerQueue above) stays —
    // HTTP paths must still enqueue — but no BullMQ Worker is created.
    ...(processorsEnabled() ? [MarketingSyncProcessor] : []),
  ],
  exports: [
    MarketingAttributionService,
    MarketingAllocationService,
    MarketingSyncService,
    MarketingPlatformsService,
    MarketingPaymentService,
  ],
})
export class MarketingModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(MarketingModule.name);

  constructor(
    @InjectQueue(MARKETING_QUEUE) private marketingQueue: Queue,
    private prisma: PrismaService,
    private platforms: MarketingPlatformsService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.platforms.ensureDefaults();

      // Worker split (WORKER_MODE): the sync-all enqueue + repeatable are
      // scheduler work — the api process owns them. In `worker` mode this
      // process only consumes jobs. (ensureDefaults above stays: idempotent
      // seeding, harmless in both processes.)
      if (!schedulersEnabled()) {
        this.logger.log(
          'Marketing sync scheduling skipped (WORKER_MODE=worker — api owns scheduling)',
        );
        return;
      }

      const setting = await this.prisma.systemSetting.findFirst({
        where: { key: SYNC_INTERVAL_SETTING },
      });
      const hours = setting?.value ? parseInt(setting.value, 10) : DEFAULT_SYNC_INTERVAL_HOURS;
      const intervalMs = Math.max(1, isNaN(hours) ? DEFAULT_SYNC_INTERVAL_HOURS : hours) * 3600 * 1000;

      await this.marketingQueue.add(
        'sync-all',
        { type: 'sync-all' } as any,
        {
          jobId: 'marketing-sync-immediate',
          removeOnComplete: 1,
          removeOnFail: 200,
        },
      );
      await this.marketingQueue.add(
        'sync-all',
        { type: 'sync-all' } as any,
        {
          jobId: 'marketing-sync-repeat',
          repeat: { every: intervalMs },
          removeOnComplete: 1,
          removeOnFail: 200,
        },
      );
      this.logger.log(`Marketing sync repeat job scheduled every ${intervalMs / 3600 / 1000}h`);
    } catch (err) {
      this.logger.warn(
        `Marketing sync bootstrap skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}