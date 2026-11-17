import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { CmsPagesModule } from '../cms-pages/cms-pages.module';
import { PlatformServiceTokenGuard } from '../entitlements/platform-service-token.guard';
import { StorageService } from '../storage/storage.service';
import { ProvisioningController } from './provisioning.controller';
import { TenantBootstrapService } from './tenant-bootstrap.service';
import { TenantDataService } from './tenant-data.service';
import { TenantOwnerService } from './tenant-owner.service';

@Module({
  // TenantDataService injects DiscoveryService to find BullMQ queues at
  // purge time; without this import the backend fails to boot (the
  // injection is deliberately required — see the constructor comment).
  imports: [DiscoveryModule, CmsPagesModule, AuthModule],
  controllers: [ProvisioningController],
  providers: [
    TenantBootstrapService,
    TenantDataService,
    TenantOwnerService,
    PlatformServiceTokenGuard,
    StorageService,
  ],
})
export class ProvisioningModule {}
