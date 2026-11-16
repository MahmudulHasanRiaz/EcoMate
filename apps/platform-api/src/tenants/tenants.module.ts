import { Module } from '@nestjs/common';
import { DomainConfigModule } from '../config/domain-config.module';
import { DomainsModule } from '../domains/domains.module';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [DomainConfigModule, DomainsModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantLifecycleService],
  exports: [TenantsService, TenantLifecycleService],
})
export class TenantsModule {}
