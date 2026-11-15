import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../tenancy/skip-tenant.decorator';
import { SkipSubscription } from '../tenancy/skip-subscription.decorator';
import { TenantEntitlementsService } from '../tenancy/tenant-entitlements.service';
import { TenantRegistrySyncService } from '../tenancy/tenant-registry-sync.service';
import { PlatformServiceTokenGuard } from './platform-service-token.guard';
import { TenantLimitsService } from './tenant-limits.service';

@SkipSubscription()
@Controller('entitlements')
export class EntitlementsController {
  constructor(
    private readonly entitlements: TenantEntitlementsService,
    private readonly limits: TenantLimitsService,
    private readonly registrySync: TenantRegistrySyncService,
  ) {}

  @Get('me')
  getMine() {
    return this.entitlements.getSnapshot();
  }

  @Get('usage')
  getUsage() {
    return this.limits.getUsageSnapshot();
  }

  @Public()
  @Get('public')
  getPublic() {
    return {
      planName: this.entitlements.getPlanName(),
      features: this.entitlements.getActiveFeatures(),
      accessState: this.entitlements.getAccessState(),
    };
  }

  /**
   * Platform → tenant push: pull the registry again now instead of waiting for
   * the next poll. The platform calls this on every instance after a plan,
   * subscription or domain change.
   */
  @Public()
  @SkipTenant()
  @UseGuards(PlatformServiceTokenGuard)
  @Post('refresh')
  async refresh() {
    const refreshed = await this.registrySync.refreshNow();
    return { refreshed, ...this.registrySync.getStatus() };
  }
}
