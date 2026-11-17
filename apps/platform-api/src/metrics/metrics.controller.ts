import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MetricsService } from './metrics.service';


@Controller('metrics')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /**
   * Revenue, trial, churn and collections read-model.
   *
   * The window arrives as a query string; anything that is not a finite number
   * is treated as "default window" instead of being forwarded raw.
   */
  @Get('overview')
  @Roles(...READ_ROLES)
  overview(@Query('window') window?: string) {
    const days = window === undefined ? undefined : Number(window);
    return this.metrics.overview(
      days === undefined || Number.isFinite(days) ? days : undefined,
    );
  }
}
