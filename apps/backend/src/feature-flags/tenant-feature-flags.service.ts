import { Injectable } from '@nestjs/common';
import { TenantEntitlementsService } from '../tenancy/tenant-entitlements.service';

/**
 * Compatibility surface for the existing @RequiresFeature decorators/services.
 * Feature checks resolve against the tenant's platform entitlement snapshot.
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
