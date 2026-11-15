import { Module } from '@nestjs/common';
import { DomainConfigModule } from '../config/domain-config.module';
import { DomainsModule } from '../domains/domains.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [DomainConfigModule, DomainsModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
