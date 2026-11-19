import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PlansModule } from '../plans/plans.module';
import { AddOnsController } from './add-ons.controller';
import { AddOnsService } from './add-ons.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [BillingModule, PlansModule],
  controllers: [PricingController, AddOnsController],
  providers: [PricingService, PurchasesService, AddOnsService],
  exports: [PricingService, PurchasesService, AddOnsService],
})
export class PricingModule {}
