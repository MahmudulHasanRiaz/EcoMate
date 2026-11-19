import { forwardRef, Module } from '@nestjs/common';
import { EmailBalanceModule } from '../email-balance/email-balance.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceService } from './invoice.service';

@Module({
  // Circular by design (see BillingService ctor): approveProof credits
  // email top-ups in-transaction, while EmailBalanceService creates
  // top-up invoices through InvoiceService. forwardRef on both sides.
  imports: [forwardRef(() => EmailBalanceModule)],
  controllers: [BillingController],
  providers: [BillingService, InvoiceService, InvoicePdfService],
  exports: [BillingService, InvoiceService, InvoicePdfService],
})
export class BillingModule {}
