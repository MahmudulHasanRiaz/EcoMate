import { Module } from '@nestjs/common';
import { DomainConfigModule } from '../config/domain-config.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DomainConfigModule],
  controllers: [HealthController],
})
export class HealthModule {}
