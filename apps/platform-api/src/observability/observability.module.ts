import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { buildPinoHttpOptions } from './logging.config';
import { HttpMetricsInterceptor } from './metrics.interceptor';
import { PrometheusMetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { RequestIdMiddleware } from './request-id.middleware';

/**
 * Phase 8 Stage 2 items 19–20 (platform half): structured request-tagged
 * logging (nestjs-pino), Prometheus /metrics, and the request-id
 * middleware. Alerts live in AlertsModule (imported directly by the jobs
 * and tenants modules); the billing-job watcher lives in JobsModule so
 * this module never imports it (no cycle).
 *
 * forRootAsync (not forRoot): the pino options read env, and env loading
 * (ConfigModule) happens at module-instantiation time — a forRoot call
 * would evaluate at module-import time instead.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => ({ pinoHttp: buildPinoHttpOptions() }),
    }),
  ],
  controllers: [PrometheusMetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
