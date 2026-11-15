import { Global, Module } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { TenantMiddleware } from './tenant.middleware';
import { TenantPrismaManager } from './tenant-prisma.manager';
import { TenantRegistryService } from './tenant-registry.service';
import { TenantRegistrySyncService } from './tenant-registry-sync.service';
import { RlsCoverageService } from './rls-coverage.service';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { TenantSubscriptionGuard } from './tenant-subscription.guard';
import { TenantResolveController } from './tenant-resolve.controller';

@Global()
@Module({
  controllers: [TenantResolveController],
  providers: [
    TenantRegistryService,
    TenantRegistrySyncService,
    TenantPrismaManager,
    RlsCoverageService,
    TenantEntitlementsService,
    TenantMiddleware,
    TenantGuard,
    TenantSubscriptionGuard,
  ],
  exports: [
    TenantRegistryService,
    TenantRegistrySyncService,
    TenantPrismaManager,
    RlsCoverageService,
    TenantEntitlementsService,
    TenantMiddleware,
    TenantGuard,
    TenantSubscriptionGuard,
  ],
})
export class TenancyModule {}
