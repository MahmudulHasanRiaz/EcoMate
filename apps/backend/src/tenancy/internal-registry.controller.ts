import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PlatformServiceTokenGuard } from '../entitlements/platform-service-token.guard';
import { SkipTenant } from './skip-tenant.decorator';
import { SkipSubscription } from './skip-subscription.decorator';
import { TenantRegistryService } from './tenant-registry.service';
import { TenantRegistrySyncService } from './tenant-registry-sync.service';

/**
 * Provisioning-triggered registry refresh (Phase 8 finding 2).
 *
 * The backend polls the platform registry every 60s
 * (TENANT_REGISTRY_REFRESH_MS), so a just-provisioned tenant's host 403s
 * ("Tenant context is required") for up to a minute after provisioning
 * succeeds. The platform calls this endpoint right after a provisioning
 * job succeeds, so the new tenant is routable immediately. Best-effort on
 * the caller side: if this fails, the next scheduled poll still picks the
 * tenant up within 60s.
 */
@Controller('internal/tenants/registry')
export class InternalRegistryController {
  constructor(
    private readonly sync: TenantRegistrySyncService,
    private readonly registry: TenantRegistryService,
  ) {}

  @Public()
  @SkipTenant()
  // The platform calls this with no tenant host, so without this the
  // subscription guard fails the POST closed in production ("This
  // workspace is read-only") — the push would silently never work outside
  // dev, where the dev wildcard masks the gap. Every other internal
  // provisioning endpoint carries this decorator for the same reason.
  @SkipSubscription()
  @UseGuards(PlatformServiceTokenGuard)
  @Post('refresh')
  @HttpCode(200)
  async refresh() {
    const refreshed = await this.sync.refreshNow();
    const domains = this.registry.getDomainConfig();
    return {
      refreshed,
      tenants: this.registry.list().length,
      domains: {
        primaryDomain: domains.primaryDomain,
        baseDomains: domains.baseDomains,
        source: this.registry.getDomainConfigSource(),
        updatedAt: this.registry.getDomainConfigUpdatedAt()?.toISOString() ?? null,
      },
    };
  }
}
