import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalServiceGuard } from '../internal/internal-service.guard';
import { CreatePlanChangeRequestDto } from './dto/create-plan-change-request.dto';
import {
  PlanChangeRequestView,
  PlanChangeRequestsService,
} from './plan-change-requests.service';

/**
 * Tenant self-service plan-change requests for the tenant backend.
 * Service-token guarded like the other /internal endpoints — the backend
 * is the caller, never the browser.
 *
 * Tenant scoping: every route takes the tenant id from the path, and the
 * service verifies rows belong to that tenant (getOne looks the request
 * up by id AND tenantId — a tenant must never read another tenant's
 * requests).
 */
@Controller('internal/tenants/:tenantId/plan-change-requests')
@UseGuards(InternalServiceGuard)
export class InternalPlanChangeRequestsController {
  constructor(private readonly requests: PlanChangeRequestsService) {}

  @Get()
  list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<PlanChangeRequestView[]> {
    return this.requests.listMine(tenantId);
  }

  @Post()
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreatePlanChangeRequestDto,
  ): Promise<PlanChangeRequestView> {
    return this.requests.create(tenantId, dto);
  }

  @Get(':id')
  getOne(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlanChangeRequestView> {
    return this.requests.getOne(tenantId, id);
  }
}
