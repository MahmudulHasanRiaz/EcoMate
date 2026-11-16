import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DomainConfigModule } from '../config/domain-config.module';
import { DomainsModule } from '../domains/domains.module';
import { ImpersonationService } from './impersonation.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [BillingModule, DomainConfigModule, DomainsModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantLifecycleService, ImpersonationService],
  exports: [TenantsService, TenantLifecycleService, ImpersonationService],
})
export class TenantsModule {}
