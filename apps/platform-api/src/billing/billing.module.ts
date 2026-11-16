import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceService } from './invoice.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, InvoiceService, InvoicePdfService],
  exports: [BillingService, InvoiceService, InvoicePdfService],
})
export class BillingModule {}
