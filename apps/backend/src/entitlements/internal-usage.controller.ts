import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SkipSubscription } from '../tenancy/skip-subscription.decorator';
import { SkipTenant } from '../tenancy/skip-tenant.decorator';
import { runWithTenant } from '../tenancy/tenant-context';
import { InternalUsageQueryDto } from './dto/internal-usage-query.dto';
import { PlatformServiceTokenGuard } from './platform-service-token.guard';
import { TenantLimitsService } from './tenant-limits.service';

/**
 * Platform → tenant usage read. The platform collects counters for every
 * tenant it owns, so this endpoint is service-token guarded and scoped to the
 * explicit tenant id supplied by the control plane.
 */
@Controller('internal/usage')
export class InternalUsageController {
  constructor(private readonly limits: TenantLimitsService) {}

  @Public()
  @SkipTenant()
  @SkipSubscription()
  @UseGuards(PlatformServiceTokenGuard)
  @Get()
  async getUsage(@Query() query: InternalUsageQueryDto) {
    if (!query?.tenantId || !query?.slug) {
      throw new BadRequestException('tenantId and slug are required');
    }
    // A window must be complete and ordered; a half-open or inverted
    // window is a caller bug, not a defaultable query.
    let window: { from: Date; to: Date } | undefined;
    if (query.from !== undefined || query.to !== undefined) {
      if (!query.from || !query.to) {
        throw new BadRequestException('from and to must be provided together');
      }
      const from = new Date(query.from);
      const to = new Date(query.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestException('from and to must be valid ISO dates');
      }
      if (from >= to) {
        throw new BadRequestException('from must be before to');
      }
      window = { from, to };
    }

    const snapshot = await runWithTenant(
      { tenantId: query.tenantId, slug: query.slug, status: 'active' },
      () => this.limits.getUsageSnapshot(window),
    );

    return {
      tenantId: query.tenantId,
      capturedAt: new Date().toISOString(),
      ...(window
        ? { window: { from: window.from.toISOString(), to: window.to.toISOString() } }
        : {}),
      ...snapshot,
    };
  }
}
