import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '../internal/internal-service.guard';
import {
  PlanChangeRequestsService,
  TrialReviewView,
} from './plan-change-requests.service';

/**
 * Trial conversion review for the tenant backend (trial-end design
 * 2026-11-22). Service-token guarded like the other /internal
 * endpoints — the backend is the caller, never the browser. The tenant
 * id comes from the path; the service verifies the tenant exists.
 */
@Controller('internal/tenants/:tenantId/trial-review')
@UseGuards(InternalServiceGuard)
export class InternalTrialReviewController {
  constructor(private readonly requests: PlanChangeRequestsService) {}

  @Get()
  getTrialReview(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<TrialReviewView> {
    return this.requests.getTrialReview(tenantId);
  }
}
