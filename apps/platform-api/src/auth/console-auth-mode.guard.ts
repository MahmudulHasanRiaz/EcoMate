import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CentralSessionAuthGuard } from './central-session-auth.guard';
import { ConsoleAuthModeService } from './console-auth-mode.service';
import { PlatformAuthGuard } from './platform-auth.guard';

// Phase 4 central-auth cutover — the flag-delegating console auth guard.
//
// ONE guard name for every protected console handler (this is what
// controllers reference and what `authorization-coverage.spec.ts`
// asserts). Per request it delegates to CentralSessionAuthGuard when
// CONSOLE_AUTH_MODE=central-ba, otherwise to the legacy
// PlatformAuthGuard. The flag defaults to custom-jwt, so current
// behaviour is unchanged until the operator flips it. Mirrors the
// backend's TenantAuthModeGuard (Phase 3).
@Injectable()
export class ConsoleAuthModeGuard implements CanActivate {
  constructor(
    private readonly mode: ConsoleAuthModeService,
    private readonly legacyGuard: PlatformAuthGuard,
    private readonly centralGuard: CentralSessionAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.mode.isCentralMode()) {
      return this.centralGuard.canActivate(context);
    }
    return this.legacyGuard.canActivate(context);
  }
}
