import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConsoleAuthModeService } from './console-auth-mode.service';

/**
 * Phase 4 central-auth cutover — legacy-only gate.
 *
 * Passes in `custom-jwt` mode; throws 410 in `central-ba` mode (via
 * `ConsoleAuthModeService.assertLegacyMode`). Applied (first in the
 * guard list, so the 410 wins over any credential check) to the
 * endpoints that have no central-mode equivalent: POST /auth/login,
 * POST /auth/refresh, and all six POST /auth/mfa/* routes. The console
 * signs in through Better Auth directly in central-ba mode, so these
 * endpoints are dead, not shims.
 */
@Injectable()
export class LegacyAuthOnlyGuard implements CanActivate {
  constructor(private readonly mode: ConsoleAuthModeService) {}

  canActivate(_context: ExecutionContext): boolean {
    this.mode.assertLegacyMode();
    return true;
  }
}
