import { Global, Module } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { TenantFeatureFlagsService } from './tenant-feature-flags.service';

/**
 * Phase 3 bridge: existing services/controllers still inject the package
 * FeatureFlagsService token, but the implementation is now backed by the
 * tenant's platform entitlement snapshot rather than a license server.
 */
@Global()
@Module({
  providers: [
    TenantFeatureFlagsService,
    {
      provide: FeatureFlagsService,
      useExisting: TenantFeatureFlagsService,
    },
  ],
  exports: [FeatureFlagsService, TenantFeatureFlagsService],
})
export class FeatureFlagsModule {}
