import { Module } from '@nestjs/common';
import { TenantBillingController } from './billing.controller';
import { TenantBillingService } from './billing.service';

@Module({
  controllers: [TenantBillingController],
  providers: [TenantBillingService],
  exports: [TenantBillingService],
})
export class TenantBillingModule {}
