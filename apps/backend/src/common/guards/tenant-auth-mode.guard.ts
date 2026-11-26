// Phase 3 central-auth cutover — the flag-delegating auth guard.
//
// ONE APP_GUARD in app.module.ts (position 4, where DualModeAuthGuard
// sat). Per request it delegates to CentralSessionAuthGuard when
// TENANT_AUTH_MODE=central-ba, otherwise to the legacy DualModeAuthGuard.
// The flag defaults to legacy-jwt, so current behaviour is unchanged
// until the operator flips it.
import { Injectable, ExecutionContext } from '@nestjs/common';
import { getTenantAuthMode } from '../tenant-auth-mode';
import { CentralSessionAuthGuard } from './central-session-auth.guard';
import { DualModeAuthGuard } from './dual-mode-auth.guard';

@Injectable()
export class TenantAuthModeGuard {
  constructor(
    private readonly legacyGuard: DualModeAuthGuard,
    private readonly centralGuard: CentralSessionAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (getTenantAuthMode() === 'central-ba') {
      return this.centralGuard.canActivate(context);
    }
    return this.legacyGuard.canActivate(context);
  }
}
