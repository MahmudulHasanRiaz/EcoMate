import { Global, Module } from '@nestjs/common';
import { DomainConfigModule } from '../config/domain-config.module';
import { EmailBalanceModule } from '../email-balance/email-balance.module';
import { ProvisioningService } from './provisioning.service';

@Global()
@Module({
  imports: [DomainConfigModule, EmailBalanceModule],
  providers: [ProvisioningService],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}
