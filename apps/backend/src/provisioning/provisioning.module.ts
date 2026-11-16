import { Module } from '@nestjs/common';
import { PlatformServiceTokenGuard } from '../entitlements/platform-service-token.guard';
import { ProvisioningController } from './provisioning.controller';
import { TenantBootstrapService } from './tenant-bootstrap.service';

@Module({
  controllers: [ProvisioningController],
  providers: [TenantBootstrapService, PlatformServiceTokenGuard],
})
export class ProvisioningModule {}
