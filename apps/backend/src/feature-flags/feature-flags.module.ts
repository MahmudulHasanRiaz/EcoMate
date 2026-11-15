import { Global, Module, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';

/**
 * Transitional feature-flag host until plan entitlements replace the legacy
 * license service. Dev/test opens the catalog; production stays closed by
 * default so a missing entitlement can never silently unlock a feature.
 */
@Global()
@Module({
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule implements OnModuleInit {
  constructor(private readonly flags: FeatureFlagsService) {}

  onModuleInit(): void {
    if (
      process.env.SKIP_LICENSE_CHECK === 'true' ||
      process.env.NODE_ENV !== 'production'
    ) {
      this.flags.setLicense(['*']);
    }
  }
}
