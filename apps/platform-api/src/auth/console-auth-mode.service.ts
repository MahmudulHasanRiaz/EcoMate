import { GoneException, Injectable } from '@nestjs/common';
import {
  getConsoleAuthMode,
  isCentralAuthMode,
  type ConsoleAuthMode,
} from './console-auth-mode';

/**
 * Phase 4 central-auth cutover — mode helpers for the console flag
 * (`CONSOLE_AUTH_MODE`, see `console-auth-mode.ts`).
 *
 * - `isCentralMode()` / `getMode()` are the runtime branch point for
 *   services that dual-write (UsersService, AuthService shims).
 * - `assertLegacyMode()` is the 410 responder for the legacy credential
 *   endpoints in central-ba mode (POST /auth/login, POST /auth/refresh,
 *   all six POST /auth/mfa/*) — the Phase 3 tenant precedent: legacy
 *   endpoints return 410 in central mode, they are not shims. There is
 *   no `mfaToken` in Better Auth mode, so no login shim is built.
 */
@Injectable()
export class ConsoleAuthModeService {
  getMode(): ConsoleAuthMode {
    return getConsoleAuthMode();
  }

  isCentralMode(): boolean {
    return isCentralAuthMode();
  }

  /**
   * Throw 410 when the console runs in central-ba mode. Legacy-only
   * endpoints call this (directly, or via `LegacyAuthOnlyGuard`) before
   * doing any credential work.
   */
  assertLegacyMode(): void {
    if (isCentralAuthMode()) {
      throw new GoneException(
        'This endpoint is disabled in central-ba mode; sign in through Better Auth',
      );
    }
  }
}
