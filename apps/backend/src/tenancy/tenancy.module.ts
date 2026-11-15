import { Module } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { TenantMiddleware } from './tenant.middleware';
import { TenantPrismaManager } from './tenant-prisma.manager';
import { TenantRegistryService } from './tenant-registry.service';
import { TenantRegistrySyncService } from './tenant-registry-sync.service';

@Module({
  providers: [
    TenantRegistryService,
    TenantRegistrySyncService,
    TenantPrismaManager,
    TenantMiddleware,
    TenantGuard,
  ],
  exports: [
    TenantRegistryService,
    TenantRegistrySyncService,
    TenantPrismaManager,
    TenantMiddleware,
    TenantGuard,
  ],
})
export class TenancyModule {}
