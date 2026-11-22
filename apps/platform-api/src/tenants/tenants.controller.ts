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
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DomainsService } from '../domains/domains.service';
import { ExternalStoresService } from '../external-stores/external-stores.service';
import { AddDomainDto } from './dto/add-domain.dto';
import { CancelTenantDto } from './dto/cancel-tenant.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { ImpersonationService } from './impersonation.service';
import { TenantsService } from './tenants.service';

@Controller('tenants')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly domains: DomainsService,
    private readonly lifecycle: TenantLifecycleService,
    private readonly impersonation: ImpersonationService,
    private readonly externalStores: ExternalStoresService,
  ) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.tenants.list({ page, limit, status, search });
  }

  @Get(':id/export')
  @Roles(...READ_ROLES)
  async exportTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const file = await this.lifecycle.exportToFile(id, user?.id);
    return new StreamableFile(createReadStream(file.path), {
      type: file.encrypted ? 'application/octet-stream' : 'application/json',
      disposition: `attachment; filename="${file.filename}"`,
      length: file.sizeBytes,
    });
  }

  /**
   * Async export for large tenants: starts the export in the background
   * and returns the job id immediately. Poll the progress endpoint; when
   * the job is done, download via the download endpoint. A second start
   * while one is running returns the running job id.
   */
  @Post(':id/exports')
  @Roles(...READ_ROLES)
  startExport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.lifecycle.startExport(id, user?.id);
  }

  @Get(':id/exports/:jobId')
  @Roles(...READ_ROLES)
  exportProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.lifecycle.getExportProgress(id, jobId);
  }

  @Get(':id/exports/:jobId/download')
  @Roles(...READ_ROLES)
  downloadExport(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const file = this.lifecycle.getExportPath(id, jobId);
    return new StreamableFile(createReadStream(file.path), {
      type: file.filename.endsWith('.enc')
        ? 'application/octet-stream'
        : 'application/json',
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  @Delete(':id')
  @Roles('SUPERADMIN')
  softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.lifecycle.softDelete(id, user?.id);
  }

  @Post(':id/restore')
  @Roles('SUPERADMIN', 'SUPPORT')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.lifecycle.restore(id, user?.id);
  }

  @Post(':id/impersonate')
  @Roles('SUPERADMIN', 'SUPPORT')
  impersonate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.impersonation.create(id, user?.id);
  }

  @Post(':id/reset-owner-password')
  @Roles('SUPERADMIN', 'SUPPORT')
  resetOwnerPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.lifecycle.resetOwnerPassword(id, user?.id);
  }

  @Post(':id/purge')
  @Roles('SUPERADMIN')
  purge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.lifecycle.purgeNow(id, user?.id);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
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

  @Post(':id/provisioning/retry')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  retryProvisioning(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.tenants.retryProvisioning(id, user?.id);
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

  @Post(':id/cancel')
  @Roles('SUPERADMIN', 'BILLING')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTenantDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.tenants.cancel(id, dto, user?.id);
  }

  @Get(':id/domains')
  @Roles(...READ_ROLES)
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

  /**
   * Operator force-unbind (Phase 9 §6.2): deletes the platform binding
   * for an external store, freeing its fingerprint for another tenant.
   * The tenant-DB Store row's identity columns are cleared first (via
   * the backend internal endpoint); its history stays. SUPERADMIN-only:
   * this releases a store identity another tenant could immediately claim.
   */
  @Post(':id/external-stores/:storeId/unbind')
  @Roles('SUPERADMIN')
  forceUnbindExternalStore(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.externalStores.forceUnbind(id, storeId, user?.id);
  }
}
