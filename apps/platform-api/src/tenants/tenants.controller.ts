import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DomainsService } from '../domains/domains.service';
import { AddDomainDto } from './dto/add-domain.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly domains: DomainsService,
  ) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.tenants.list({ page, limit, status, search });
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.detail(id);
  }

  @Post()
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  create(
    @Body() dto: CreateTenantDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.tenants.create(dto, user?.id);
  }

  @Patch(':id/status')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantStatusDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.tenants.updateStatus(id, dto, user?.id);
  }

  @Post(':id/extend-trial')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  extendTrial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendTrialDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.tenants.extendTrial(id, dto.days, user?.id);
  }

  @Post(':id/change-plan')
  @Roles('SUPERADMIN', 'BILLING')
  changePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePlanDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.tenants.changePlan(id, dto, user?.id);
  }

  @Get(':id/domains')
  listDomains(@Param('id', ParseUUIDPipe) id: string) {
    return this.domains.list(id);
  }

  @Post(':id/domains')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  addDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddDomainDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.domains.addDomain(id, dto, user?.id);
  }

  @Post(':id/domains/:domainId/verify')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  verifyDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.domains.verify(id, domainId, user?.id);
  }

  @Delete(':id/domains/:domainId')
  @Roles('SUPERADMIN', 'BILLING')
  removeDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.domains.remove(id, domainId, user?.id);
  }
}
