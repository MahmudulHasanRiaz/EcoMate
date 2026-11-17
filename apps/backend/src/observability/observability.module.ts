import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { buildPinoHttpOptions } from './logging.config';
import { HttpMetricsInterceptor } from './metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { OpsAlertsService } from './ops-alerts.service';
import { QueueWatcherService } from './queue-watcher.service';

/**
 * Phase 8 Stage 2 items 19–20 (backend half): structured tenant-tagged
 * logging (nestjs-pino), Prometheus /metrics, ops email alerts, and the
 * queue watcher. Bull Board is mounted from main.ts (raw Fastify plugin,
 * not a Nest controller) — see bull-board.setup.ts.
 *
 * forRootAsync (not forRoot): the pino options read env, and backend .env
 * loading happens in main.ts bootstrap before NestFactory.create — a
 * forRoot call would evaluate at module-import time, before dotenv runs.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => ({ pinoHttp: buildPinoHttpOptions() }),
    }),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    OpsAlertsService,
    QueueWatcherService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService, OpsAlertsService],
})
export class ObservabilityModule {}
