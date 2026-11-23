// ── Courier Settlement & Invoice Management module (PRD §5–§14).
//
// Distinct from the business-analytics *sales* settlement (SettlementTable.tsx,
// /business-analytics/sales/settlement) and from Central Commerce: this module
// ingests courier invoice files, matches them to orders, and finalizes
// authoritative courier-cost + COD-settlement truth.

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CourierSettlementController } from './courier-settlement.controller';
import { CourierSettlementImportService } from './courier-settlement-import.service';
import { CourierSettlementImportProcessor } from './courier-settlement-import.processor';
import { CourierSettlementMappingService } from './column-mapping.service';
import { CourierSettlementFinalizeService } from './courier-settlement-finalize.service';
import { CourierSettlementAccountingService } from './courier-settlement-accounting.service';
import { CourierSettlementSettingsService } from './courier-settlement-settings.service';
import { CourierSettlementOverviewService } from './overview.service';
import { CourierSettlementExceptionsService } from './exceptions.service';
import { CourierSettlementAdjustmentsService } from './adjustments.service';
import { CourierSettlementSnapshotService } from './snapshot.service';
import { CourierSettlementActivityService } from './activity.service';
import { CourierSettlementReconciliationService } from './reconciliation.service';
import { CourierSettlementCostService } from './cost-projection.service';
import { ExpectedCodResolver } from './expected-cod.resolver';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { processorsEnabled } from '../common/worker-mode';
import { AccountingModule } from '../accounting/accounting.module';
import { CacheModule } from '../cache/cache.module';
import { CustomerCreditModule } from '../customer-credit/customer-credit.module';

@Module({
  imports: [
    AccountingModule,
    CacheModule,
    CustomerCreditModule,
    BullModule.registerQueue({ name: 'courier-settlement-import' }),
  ],
  controllers: [CourierSettlementController],
  providers: [
    PrismaService,
    StorageService,
    CourierSettlementImportService,
    // Worker split (WORKER_MODE): the processor runs only in `worker`/`all`
    // modes. In `api` mode the queue itself (registerQueue above) stays —
    // HTTP paths must still enqueue — but no BullMQ Worker is created.
    ...(processorsEnabled() ? [CourierSettlementImportProcessor] : []),
    CourierSettlementMappingService,
    CourierSettlementFinalizeService,
    CourierSettlementAccountingService,
    CourierSettlementSettingsService,
    CourierSettlementOverviewService,
    CourierSettlementExceptionsService,
    CourierSettlementAdjustmentsService,
    CourierSettlementSnapshotService,
    CourierSettlementActivityService,
    CourierSettlementReconciliationService,
    CourierSettlementCostService,
    ExpectedCodResolver,
  ],
  exports: [
    CourierSettlementImportService,
    CourierSettlementMappingService,
    CourierSettlementCostService,
    CourierSettlementSettingsService,
  ],
})
export class CourierSettlementModule {}