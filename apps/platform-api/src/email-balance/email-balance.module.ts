import { forwardRef, Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import {
  EmailBalanceController,
  EmailBalanceOverviewController,
} from './email-balance.controller';
import { EmailBalanceService } from './email-balance.service';

@Module({
  // Circular by design (see BillingService ctor): this module needs
  // InvoiceService for top-up invoice creation, while BillingService
  // needs EmailBalanceService for the in-transaction top-up credit in
  // approveProof. forwardRef on both sides; the provider graph itself
  // is acyclic. Prisma, Settings, Audit and PlatformMail are @Global.
  imports: [forwardRef(() => BillingModule)],
  controllers: [EmailBalanceController, EmailBalanceOverviewController],
  providers: [EmailBalanceService],
  exports: [EmailBalanceService],
})
export class EmailBalanceModule {}
