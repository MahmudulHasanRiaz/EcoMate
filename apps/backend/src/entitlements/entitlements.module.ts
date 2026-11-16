import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { EntitlementsController } from './entitlements.controller';
import { InternalUsageController } from './internal-usage.controller';
import { TenantLimitsService } from './tenant-limits.service';

@Module({
  imports: [TenancyModule],
  controllers: [EntitlementsController, InternalUsageController],
  providers: [TenantLimitsService],
  exports: [TenantLimitsService],
})
export class EntitlementsModule {}
