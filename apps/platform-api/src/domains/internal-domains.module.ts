import { Module } from '@nestjs/common';
import { DomainConfigModule } from '../config/domain-config.module';
import { InternalServiceGuard } from '../internal/internal-service.guard';
import { DomainsModule } from './domains.module';
import { InternalDomainsController } from './internal-domains.controller';

/**
 * Tenant self-service domain endpoints (internal, service-token
 * guarded). Kept as its own module so the tenant-facing surface stays
 * separate from the console DomainsModule: the controller reuses
 * DomainsService (exported by DomainsModule) and DomainConfigService,
 * while Prisma and Audit are global.
 *
 * Wiring: add InternalDomainsModule to AppModule imports.
 */
@Module({
  imports: [DomainsModule, DomainConfigModule],
  controllers: [InternalDomainsController],
  providers: [InternalServiceGuard],
})
export class InternalDomainsModule {}
