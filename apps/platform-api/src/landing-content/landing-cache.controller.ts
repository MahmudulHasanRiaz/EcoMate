import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { LandingCacheService } from './landing-cache.service';

/**
 * Landing cache purge (Batch 1, item 3). SUPERADMIN only — purging
 * revalidates the public site's cached content immediately. Audited.
 */
@Controller('landing-cache')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class LandingCacheController {
  constructor(
    private readonly cache: LandingCacheService,
    private readonly audit: AuditService,
  ) {}

  @Post('purge')
  @HttpCode(200)
  @Roles('SUPERADMIN')
  async purge(@CurrentPlatformUser() user?: { id: string }) {
    const result = await this.cache.purge();
    await this.audit.record({
      actorId: user?.id,
      action: 'landing-cache.purge',
      entity: 'LandingCache',
      entityId: 'landing',
      after: { revalidated: result.revalidated },
    });
    return result;
  }
}
