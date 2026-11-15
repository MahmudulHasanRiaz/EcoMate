import { Module } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { TenantMiddleware } from './tenant.middleware';
import { TenantPrismaManager } from './tenant-prisma.manager';
import { TenantRegistryService } from './tenant-registry.service';

@Module({
  providers: [
    TenantRegistryService,
    TenantPrismaManager,
    TenantMiddleware,
    TenantGuard,
  ],
  exports: [
    TenantRegistryService,
    TenantPrismaManager,
    TenantMiddleware,
    TenantGuard,
  ],
})
export class TenancyModule {}
