import { Module } from '@nestjs/common';
import { InternalServiceGuard } from '../internal/internal-service.guard';
import { TenantsModule } from '../tenants/tenants.module';
import { InternalPlanChangeRequestsController } from './internal-plan-change-requests.controller';
import { InternalTrialReviewController } from './internal-trial-review.controller';
import { PlanChangeRequestsController } from './plan-change-requests.controller';
import { PlanChangeRequestsService } from './plan-change-requests.service';

/**
 * Tenant plan-change requests (Subscription hub): the console operator
 * surface (PlanChangeRequestsController) and the tenant-backend
 * internal surface (InternalPlanChangeRequestsController) share one
 * service. TenantsModule is imported for TenantsService — apply()
 * delegates the actual plan change to it, so proration, metered
 * close-out and invoicing behave exactly like an operator-initiated
 * change. Prisma and Audit are global.
 *
 * Wiring: add PlanChangeRequestsModule to AppModule imports.
 */
@Module({
  imports: [TenantsModule],
  controllers: [
    PlanChangeRequestsController,
    InternalPlanChangeRequestsController,
    InternalTrialReviewController,
  ],
  providers: [PlanChangeRequestsService, InternalServiceGuard],
  exports: [PlanChangeRequestsService],
})
export class PlanChangeRequestsModule {}
