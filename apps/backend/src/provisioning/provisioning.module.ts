import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CmsPagesModule } from '../cms-pages/cms-pages.module';
import { PlatformServiceTokenGuard } from '../entitlements/platform-service-token.guard';
import { ProvisioningController } from './provisioning.controller';
import { TenantBootstrapService } from './tenant-bootstrap.service';
import { TenantDataService } from './tenant-data.service';
import { TenantOwnerService } from './tenant-owner.service';

@Module({
  imports: [CmsPagesModule, AuthModule],
  controllers: [ProvisioningController],
  providers: [
    TenantBootstrapService,
    TenantDataService,
    TenantOwnerService,
    PlatformServiceTokenGuard,
  ],
})
export class ProvisioningModule {}
