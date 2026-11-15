import { Injectable } from '@nestjs/common';
import { TenantEntitlementsService } from '../tenancy/tenant-entitlements.service';

/**
 * Compatibility surface for the existing @RequiresFeature decorators/services.
 * The old LicenseEngine-backed FeatureFlagsService is replaced at runtime by
 * this provider while the license package is removed in Phase 3.
 */
@Injectable()
export class TenantFeatureFlagsService {
  constructor(private readonly entitlements: TenantEntitlementsService) {}

  canUse(featureKey: string): boolean {
    return this.entitlements.canUse(featureKey);
  }

  getActiveFeatures(): string[] {
    return this.entitlements.getActiveFeatures();
  }
}
