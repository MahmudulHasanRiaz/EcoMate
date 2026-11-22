import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PlatformServiceTokenGuard } from '../entitlements/platform-service-token.guard';
import { SkipSubscription } from '../tenancy/skip-subscription.decorator';
import { SkipTenant } from '../tenancy/skip-tenant.decorator';
import { runWithTenant } from '../tenancy/tenant-context';
import { ReleaseStoreIdentityDto } from './dto/release-store-identity.dto';
import { StoresService } from './stores.service';

/**
 * Platform → tenant store identity release (Phase 9 §8.2.2, ruling D9).
 *
 * The platform force-unbind flow calls this BEFORE deleting the binding:
 * the tenant-DB Store row keeps its globally-unique fingerprint/domain
 * after a binding-only delete, so another tenant's re-bind still 409s on
 * the retained tenant row. The release clears only the identity columns
 * (history, mappings, credentials stay on the row).
 *
 * Same coordination pattern as the provisioning purge hook:
 * service-token guarded, explicit tenant id + slug in the body, work run
 * inside that tenant's context.
 */
@Controller('internal/stores')
export class InternalStoresController {
  constructor(private readonly stores: StoresService) {}

  @Public()
  @SkipTenant()
  @SkipSubscription()
  @UseGuards(PlatformServiceTokenGuard)
  @Post(':storeId/release-identity')
  releaseIdentity(
    @Param('storeId') storeId: string,
    @Body() dto: ReleaseStoreIdentityDto,
  ) {
    return runWithTenant(
      { tenantId: dto.tenantId, slug: dto.slug, status: 'ACTIVE' },
      () => this.stores.releaseIdentity(storeId),
    );
  }
}
