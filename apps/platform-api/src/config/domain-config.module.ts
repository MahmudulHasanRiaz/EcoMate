import { Module } from '@nestjs/common';
import { DomainConfigService } from './domain-config.service';

@Module({
  providers: [DomainConfigService],
  exports: [DomainConfigService],
})
export class DomainConfigModule {}
