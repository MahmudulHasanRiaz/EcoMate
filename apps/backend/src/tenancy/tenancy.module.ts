import { Module } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { TenantMiddleware } from './tenant.middleware';
import { TenantPrismaManager } from './tenant-prisma.manager';
import { TenantRegistryService } from './tenant-registry.service';
import { TenantRegistrySyncService } from './tenant-registry-sync.service';
import { RlsCoverageService } from './rls-coverage.service';

@Module({
  providers: [
    TenantRegistryService,
    TenantRegistrySyncService,
    TenantPrismaManager,
    RlsCoverageService,
    TenantMiddleware,
    TenantGuard,
  ],
  exports: [
    TenantRegistryService,
    TenantRegistrySyncService,
    TenantPrismaManager,
    RlsCoverageService,
    TenantMiddleware,
    TenantGuard,
  ],
})
export class TenancyModule {}
