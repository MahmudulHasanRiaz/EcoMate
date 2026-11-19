import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DomainConfigModule } from '../config/domain-config.module';
import { EmailBalanceModule } from '../email-balance/email-balance.module';
import { EncryptionModule } from '../common/encryption.module';
import { DomainsModule } from '../domains/domains.module';
import { AlertsModule } from '../observability/alerts.module';
import { PricingModule } from '../pricing/pricing.module';
import { ExportProgressRegistry } from './export-progress.registry';
import { ImpersonationService } from './impersonation.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [
    BillingModule,
    DomainConfigModule,
    DomainsModule,
    AlertsModule,
    EmailBalanceModule,
    EncryptionModule,
    PricingModule,
  ],
  controllers: [TenantsController],
  providers: [
    TenantsService,
    TenantLifecycleService,
    ImpersonationService,
    ExportProgressRegistry,
  ],
  exports: [
    TenantsService,
    TenantLifecycleService,
    ImpersonationService,
    ExportProgressRegistry,
  ],
})
export class TenantsModule {}
