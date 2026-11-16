import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { TenantsModule } from '../tenants/tenants.module';
import { BillingJobsService } from './billing-jobs.service';
import { JobsController } from './jobs.controller';

@Module({
  imports: [BillingModule, TenantsModule],
  controllers: [JobsController],
  providers: [BillingJobsService],
  exports: [BillingJobsService],
})
export class JobsModule {}
