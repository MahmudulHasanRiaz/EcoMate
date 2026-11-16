import { Global, Module } from '@nestjs/common';
import { DomainConfigModule } from '../config/domain-config.module';
import { ProvisioningService } from './provisioning.service';

@Global()
@Module({
  imports: [DomainConfigModule],
  providers: [ProvisioningService],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}
