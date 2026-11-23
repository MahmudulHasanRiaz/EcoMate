/**
 * Stores module — central-commerce P1 foundation + P3 distribution + P4 sync
 * + P6 order ingestion.
 *
 * P4: six sync queues (explicit concurrency + limiter each, R-8), the
 * ownership/conflict engine with the override workflow, category lifecycle,
 * sync-ops API and in-process processors (single-instance, no worker proc).
 * P6: route-scoped raw-body webhook receiver (HMAC, dedupe, replay guard),
 * the normalize-and-ingest worker, hourly bounded 3-day reconcile with
 * opt-in widening, and the read-only bridge contact-check (BR-14).
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { ExternalStoresModule } from '../external-stores/external-stores.module';
// MediaModule has no imports of its own — safe to import here (no cycle);
// the import image processor downloads remote images via MediaService.
import { MediaModule } from '../media/media.module';
import { EncryptionService } from '../common/utils/encryption';
// NOTE: OrdersModule is deliberately NOT imported here. StockModule and
// InventoryModule (both imported by OrdersModule) import StoresModule, so a
// static StoresModule → OrdersModule edge is a file-level cycle. The ingest
// service resolves OrdersService lazily via ModuleRef instead (§8.5).
// TenancyModule is @Global, so TenantEntitlementsService /
// TenantRegistryService resolve without an import here.
import { BlockedEntriesModule } from '../blocked-entries/blocked-entries.module';
import { CustomersModule } from '../customers/customers.module';
import { PlatformServiceTokenGuard } from '../entitlements/platform-service-token.guard';
import { StoresService } from './stores.service';
import { StoresController } from './stores.controller';
import { InternalStoresController } from './internal-stores.controller';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { ProviderUrlGuard } from './providers/provider-url-guard';
import { WooCommerceProvider } from './providers/woocommerce.provider';
import { ShopifyProvider } from './providers/shopify.provider';
import { CustomBridgeProvider } from './providers/custom-bridge.provider';
import { StoreAvailabilityService } from './distribution/store-availability.service';
import { FieldOwnershipService } from './distribution/field-ownership.service';
import { DistributionService } from './distribution/distribution.service';
import {
  ProductStoreAvailabilityController,
  StoreAvailabilityRulesController,
} from './distribution/distribution.controller';
import { SyncRunService } from './sync/sync-run.service';
import { StoreProductImportService } from './sync/store-product-import.service';
import {
  StoreProductImportImagesProcessor,
  StoreProductImportProcessor,
} from './sync/store-product-import.processor';
import { SyncNotifyService } from './sync/sync-notify.service';
import { SyncRetentionService } from './sync/sync-retention.service';
import { SyncRetentionScheduler } from './sync/sync-retention.scheduler';
import { SyncRetryService } from './sync/sync-retry.service';
import { CategorySyncService } from './sync/category-sync.service';
import { ProductSyncService } from './sync/product-sync.service';
import { StockStatusSyncService } from './sync/stock-status-sync.service';
import { SyncQueuesService } from './sync/sync-queues.service';
import { StoreCircuitBreaker } from './sync/sync-circuit';
import {
  StoreMaintenanceProcessor,
  StoreOrderIngestProcessor,
  StoreOrderPushProcessor,
  StoreProductSyncProcessor,
  StoreReconcileProcessor,
  StoreStockSyncProcessor,
} from './sync/sync.processors';
import { SyncOpsController } from './sync/sync-ops.controller';
import { StoreOverridesController } from './sync/store-overrides.controller';
import { StoreOrderIngestService } from './orders/store-order-ingest.service';
import { StoreOrderReconcileService } from './orders/store-order-reconcile.service';
import { StoreOrderPushService } from './orders/store-order-push.service';
import { StoreOrderScheduler } from './orders/store-order-scheduler';
import { StoreOrdersController } from './orders/store-orders.controller';
import { StoreWebhookService } from './webhooks/store-webhook.service';
import { StoreWebhooksController } from './webhooks/store-webhooks.controller';
import { StoreInstallController } from './webhooks/store-install.controller';
import { StoreBridgeController } from './webhooks/store-bridge.controller';
import { StoreWebhookRawBodyProvider } from './webhooks/store-webhook-rawbody.provider';

const SYNC_QUEUE_DEFAULTS = { removeOnComplete: 100, removeOnFail: 50, attempts: 1 };
/** Image downloads retry (transient CDN/origin failures are common); the
 *  processor records IMAGE_DOWNLOAD_FAILED only on the final attempt. */
const IMPORT_IMAGES_QUEUE_DEFAULTS = {
  removeOnComplete: 100,
  removeOnFail: 50,
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
};

@Module({
  imports: [
    PrismaModule,
    // SaaS: CacheModule (Redis locks + circuit breaker), EntitlementsModule
    // (TenantLimitsService for the external_stores cap), ExternalStoresModule
    // (platform binding client + tenant resolver).
    CacheModule,
    EntitlementsModule,
    ExternalStoresModule,
    BlockedEntriesModule,
    CustomersModule,
    MediaModule,
    BullModule.registerQueue(
      { name: 'store-product-sync', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-stock-sync', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-order-ingest', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-order-push', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-reconcile', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-maintenance', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-product-import', defaultJobOptions: SYNC_QUEUE_DEFAULTS },
      { name: 'store-product-import-images', defaultJobOptions: IMPORT_IMAGES_QUEUE_DEFAULTS },
    ),
  ],
  controllers: [
    StoresController,
    InternalStoresController,
    ProductStoreAvailabilityController,
    StoreAvailabilityRulesController,
    SyncOpsController,
    StoreOverridesController,
    StoreOrdersController,
    StoreWebhooksController,
    StoreInstallController,
    StoreBridgeController,
  ],
  providers: [
    StoresService,
    // PlatformServiceTokenGuard is registered like ProvisioningModule
    // does — the internal controller's guard resolves from here.
    PlatformServiceTokenGuard,
    ProviderRegistryService,
    ProviderUrlGuard,
    WooCommerceProvider,
    ShopifyProvider,
    CustomBridgeProvider,
    EncryptionService,
    StoreAvailabilityService,
    FieldOwnershipService,
    DistributionService,
    SyncRunService,
    SyncNotifyService,
    SyncRetentionService,
    SyncRetentionScheduler,
    SyncRetryService,
    CategorySyncService,
    ProductSyncService,
    StockStatusSyncService,
    SyncQueuesService,
    StoreCircuitBreaker,
    StoreOrderIngestService,
    StoreOrderReconcileService,
    StoreOrderPushService,
    StoreOrderScheduler,
    StoreWebhookService,
    StoreWebhookRawBodyProvider,
    StoreProductImportService,
    StoreProductSyncProcessor,
    StoreStockSyncProcessor,
    StoreOrderIngestProcessor,
    StoreOrderPushProcessor,
    StoreReconcileProcessor,
    StoreMaintenanceProcessor,
    StoreProductImportProcessor,
    StoreProductImportImagesProcessor,
  ],
  exports: [
    StoresService,
    ProviderRegistryService,
    StoreAvailabilityService,
    DistributionService,
    SyncRunService,
    SyncNotifyService,
    SyncRetentionService,
    SyncRetryService,
    ProductSyncService,
    SyncQueuesService,
    StockStatusSyncService,
    StoreOrderIngestService,
    StoreOrderReconcileService,
    StoreOrderPushService,
    StoreWebhookService,
    StoreProductImportService,
  ],
})
export class StoresModule {}
