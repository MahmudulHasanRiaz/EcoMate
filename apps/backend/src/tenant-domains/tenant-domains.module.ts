import { Module } from '@nestjs/common';
import { TenantDomainsController } from './tenant-domains.controller';
import { TenantDomainsService } from './tenant-domains.service';

/**
 * Tenant self-service custom domains (proxied to the platform API).
 *
 * Wiring: add TenantDomainsModule to AppModule imports.
 */
@Module({
  controllers: [TenantDomainsController],
  providers: [TenantDomainsService],
  exports: [TenantDomainsService],
})
export class TenantDomainsModule {}
