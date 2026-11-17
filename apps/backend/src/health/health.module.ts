import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { HealthController } from './health.controller';
import { QueueHealthService } from './queue-health.service';

@Module({
  // QueueHealthService injects DiscoveryService (@nestjs/core), which is
  // provided by DiscoveryModule — without this import the backend cannot
  // boot at all (UnknownDependenciesException). Found live 2026-11-17
  // during Phase 8 Stage 2 verification; unit tests never caught it
  // because they construct the service directly, not via Nest DI.
  imports: [DiscoveryModule],
  controllers: [HealthController],
  providers: [QueueHealthService],
})
export class HealthModule {}
