import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { EntitlementsController } from './entitlements.controller';
import { TenantLimitsService } from './tenant-limits.service';

@Module({
  imports: [TenancyModule],
  controllers: [EntitlementsController],
  providers: [TenantLimitsService],
  exports: [TenantLimitsService],
})
export class EntitlementsModule {}
