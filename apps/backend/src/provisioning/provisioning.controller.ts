import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PlatformServiceTokenGuard } from '../entitlements/platform-service-token.guard';
import { SkipSubscription } from '../tenancy/skip-subscription.decorator';
import { SkipTenant } from '../tenancy/skip-tenant.decorator';
import { runWithTenant } from '../tenancy/tenant-context';
import { ProvisionTenantDto } from './dto/provision-tenant.dto';
import { RollbackProvisioningDto } from './dto/rollback-provisioning.dto';
import { TenantDataDto } from './dto/tenant-data.dto';
import { TenantBootstrapService } from './tenant-bootstrap.service';
import { TenantDataService } from './tenant-data.service';

@Controller('internal/provisioning')
export class ProvisioningController {
  constructor(
    private readonly bootstrap: TenantBootstrapService,
    private readonly data: TenantDataService,
  ) {}

  /**
   * Platform → tenant bootstrap. The platform creates the tenant/subdomain/
   * trial rows first, then calls this with the explicit tenant id so the
   * shared tenant database can be seeded before the tenant has any live host.
   */
  @Public()
  @SkipTenant()
  @SkipSubscription()
  @UseGuards(PlatformServiceTokenGuard)
  @Post()
  provision(@Body() dto: ProvisionTenantDto) {
    return runWithTenant(
      { tenantId: dto.tenantId, slug: dto.slug, status: 'active' },
      () => this.bootstrap.bootstrap(dto),
    );
  }

  /**
   * Cleanup after a failed bootstrap. Refuses once the tenant has any business
   * data, so a partially live workspace can never be erased by a retry.
   */
  @Public()
  @SkipTenant()
  @SkipSubscription()
  @UseGuards(PlatformServiceTokenGuard)
  @Post('rollback')
  rollback(@Body() dto: RollbackProvisioningDto) {
    return runWithTenant(
      { tenantId: dto.tenantId, slug: dto.slug, status: 'active' },
      () => this.bootstrap.rollback(dto),
    );
  }

  /** Full dependency-ordered export consumed by the platform lifecycle job. */
  @Public()
  @SkipTenant()
  @SkipSubscription()
  @UseGuards(PlatformServiceTokenGuard)
  @Post('export')
  exportTenant(@Body() dto: TenantDataDto) {
    return runWithTenant(
      { tenantId: dto.tenantId, slug: dto.slug, status: 'active' },
      () => this.data.exportTenant(dto.tenantId),
    );
  }

  /** Hard-deletes every tenant-scoped row; called only after retention. */
  @Public()
  @SkipTenant()
  @SkipSubscription()
  @UseGuards(PlatformServiceTokenGuard)
  @Post('purge')
  purgeTenant(@Body() dto: TenantDataDto) {
    return runWithTenant(
      { tenantId: dto.tenantId, slug: dto.slug, status: 'active' },
      () => this.data.purgeTenant(dto.tenantId),
    );
  }
}
