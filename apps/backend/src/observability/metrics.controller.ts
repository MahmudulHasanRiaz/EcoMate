import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SkipSubscription } from '../tenancy/skip-subscription.decorator';
import { SkipTenant } from '../tenancy/skip-tenant.decorator';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint at GET /metrics (root — excluded from the
 * global /api prefix in main.ts, so the edge never proxies it to tenants;
 * it is reachable on the private network only). Public by design: the
 * scraper carries no tenant JWT. Same guard-skips as the health endpoint.
 */
@Public()
@SkipTenant()
@SkipSubscription()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    return this.metrics.getMetrics();
  }
}
