import { Module } from '@nestjs/common';
import { CmsPagesModule } from '../cms-pages/cms-pages.module';
import { PlatformServiceTokenGuard } from '../entitlements/platform-service-token.guard';
import { ProvisioningController } from './provisioning.controller';
import { TenantBootstrapService } from './tenant-bootstrap.service';

@Module({
  imports: [CmsPagesModule],
  controllers: [ProvisioningController],
  providers: [TenantBootstrapService, PlatformServiceTokenGuard],
})
export class ProvisioningModule {}
