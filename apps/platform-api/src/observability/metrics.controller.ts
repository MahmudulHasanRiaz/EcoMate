import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint at GET /metrics (root — excluded from the
 * global /api prefix in main.ts, so it never collides with the business
 * metrics at /api/metrics/overview and the edge never proxies it to
 * tenants; reachable on the private network only). No auth guard: the
 * scraper carries no platform JWT, and the route carries no tenant data.
 */
@Controller('metrics')
export class PrometheusMetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    return this.metrics.getMetrics();
  }
}
