import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { TenantsModule } from '../tenants/tenants.module';
import { InternalController } from './internal.controller';
import { InternalServiceGuard } from './internal-service.guard';

@Module({
  imports: [BillingModule, TenantsModule],
  controllers: [InternalController],
  providers: [InternalServiceGuard],
})
export class InternalModule {}
