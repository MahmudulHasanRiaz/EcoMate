import { Controller, Get } from '@nestjs/common';
import { ConsoleAuthModeService } from './console-auth-mode.service';

/**
 * Phase 4 central-auth cutover — public runtime auth-mode endpoint.
 *
 * `GET /api/public/auth-mode` → `{ mode: 'custom-jwt' | 'central-ba' }`.
 * No auth, no PII, cacheable. The console (platform-admin) reads it at
 * boot and branches between the legacy JWT flow and the Better Auth
 * client — a build-time `VITE_*` flag cannot flip without a redeploy,
 * which would defeat the rollback. Reads the same env the guards read,
 * so the flag flip takes effect without a restart.
 */
@Controller('public')
export class PublicAuthModeController {
  constructor(private readonly mode: ConsoleAuthModeService) {}

  @Get('auth-mode')
  authMode() {
    return { mode: this.mode.getMode() };
  }
}
