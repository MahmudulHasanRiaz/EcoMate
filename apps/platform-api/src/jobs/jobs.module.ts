import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DomainConfigModule } from '../config/domain-config.module';
import { EmailBalanceModule } from '../email-balance/email-balance.module';
import { AlertsModule } from '../observability/alerts.module';
import { ObservabilityModule } from '../observability/observability.module';
import { PricingModule } from '../pricing/pricing.module';
import { TenantsModule } from '../tenants/tenants.module';
import { BillingJobsService } from './billing-jobs.service';
import { JobFailureWatcherService } from './job-failure-watcher.service';
import { JobsController } from './jobs.controller';
import { TlsHealthService } from './tls-health.service';

@Module({
  imports: [
    BillingModule,
    TenantsModule,
    PricingModule,
    AlertsModule,
    DomainConfigModule,
    EmailBalanceModule,
    ObservabilityModule,
  ],
  controllers: [JobsController],
  providers: [BillingJobsService, TlsHealthService, JobFailureWatcherService],
  exports: [BillingJobsService, TlsHealthService],
})
export class JobsModule {}
