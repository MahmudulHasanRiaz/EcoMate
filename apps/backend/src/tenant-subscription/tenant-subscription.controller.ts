import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SkipSubscription } from '../tenancy/skip-subscription.decorator';
import { requireTenantId } from '../tenancy/tenant-context';
import { CreatePlanChangeRequestDto } from './dto/create-plan-change-request.dto';
import { TenantSubscriptionService } from './tenant-subscription.service';

/**
 * Tenant-facing subscription hub (plan catalogue + plan-change
 * requests), proxied to the platform API. The whole controller skips
 * the subscription guard on purpose: a suspended or read-only tenant
 * must still view plans and request a plan change — like billing, the
 * request is a path back to full access. The tenant id always comes
 * from the tenant context, never from the request.
 *
 * Reads are open to staff (superadmin/admin/employee); filing a
 * request is superadmin+admin only — an employee can view the plan
 * options but cannot ask to change the store's plan.
 */
@SkipSubscription()
@Controller('subscription')
export class TenantSubscriptionController {
  constructor(private readonly subscription: TenantSubscriptionService) {}

  @Get('plans')
  @Roles('superadmin', 'admin', 'employee')
  listPlans() {
    return this.subscription.listPublicPlans();
  }

  /**
   * Trial conversion review (trial-end design 2026-11-22): the trial
   * state + attached trial add-ons with prices, for the Plans tab's
   * review step. Read-only, open to staff like the plan catalogue.
   */
  @Get('trial-review')
  @Roles('superadmin', 'admin', 'employee')
  getTrialReview() {
    return this.subscription.getTrialReview(requireTenantId());
  }

  @Get('plan-change-requests')
  @Roles('superadmin', 'admin', 'employee')
  listRequests() {
    return this.subscription.listRequests(requireTenantId());
  }

  @Post('plan-change-requests')
  @Roles('superadmin', 'admin')
  createRequest(
    @Body() dto: CreatePlanChangeRequestDto,
    @CurrentUser() user?: { userId: string },
  ) {
    return this.subscription.createRequest(
      requireTenantId(),
      dto,
      user?.userId,
    );
  }

  @Get('plan-change-requests/:id')
  @Roles('superadmin', 'admin', 'employee')
  getRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscription.getRequest(requireTenantId(), id);
  }
}
