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
import { TenantBootstrapService } from './tenant-bootstrap.service';

@Controller('internal/provisioning')
export class ProvisioningController {
  constructor(private readonly bootstrap: TenantBootstrapService) {}

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
}
