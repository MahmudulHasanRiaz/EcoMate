import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApplyPlanChangeRequestDto } from './dto/apply-plan-change-request.dto';
import { RejectPlanChangeRequestDto } from './dto/reject-plan-change-request.dto';
import {
  ConsolePlanChangeRequestView,
  PlanChangeRequestStatus,
  PlanChangeRequestsService,
} from './plan-change-requests.service';

const REQUEST_STATUSES: PlanChangeRequestStatus[] = [
  'PENDING',
  'APPLIED',
  'REJECTED',
];

/**
 * Operator surface for tenant plan-change requests (console Billing →
 * Plan requests tab). List is read-role; deciding (apply/reject) is
 * SUPERADMIN + BILLING — the same roles as the operator change-plan
 * route, since apply() performs exactly that change.
 */
@Controller('plan-change-requests')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class PlanChangeRequestsController {
  constructor(private readonly requests: PlanChangeRequestsService) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('status') status?: string,
  ): Promise<ConsolePlanChangeRequestView[]> {
    if (
      status !== undefined &&
      !(REQUEST_STATUSES as string[]).includes(status)
    ) {
      throw new BadRequestException(
        'status must be PENDING, APPLIED or REJECTED',
      );
    }
    return this.requests.listForConsole({
      status: status as PlanChangeRequestStatus | undefined,
    });
  }

  @Post(':id/apply')
  @Roles('SUPERADMIN', 'BILLING')
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyPlanChangeRequestDto,
    @CurrentPlatformUser() user?: { id: string },
  ): Promise<ConsolePlanChangeRequestView> {
    return this.requests.apply(id, dto, user?.id);
  }

  @Post(':id/reject')
  @Roles('SUPERADMIN', 'BILLING')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPlanChangeRequestDto,
    @CurrentPlatformUser() user?: { id: string },
  ): Promise<ConsolePlanChangeRequestView> {
    return this.requests.reject(id, dto, user?.id);
  }
}
