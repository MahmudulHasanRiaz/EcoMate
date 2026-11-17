import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { ObservabilityModule } from './observability.module';

/**
 * Standalone alerts module. Imports ObservabilityModule only for the
 * MetricsService (alert counters) — PlatformMailService comes from the
 * @Global PlatformMailModule. Kept separate from ObservabilityModule so
 * JobsModule and TenantsModule can import alerts without an import cycle
 * (ObservabilityModule never imports Jobs/Tenants).
 */
@Module({
  imports: [ObservabilityModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
