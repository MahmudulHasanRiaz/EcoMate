import { Module } from '@nestjs/common';
import { METRICS_CLOCK } from './metrics.clock';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: METRICS_CLOCK, useValue: () => new Date() },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
