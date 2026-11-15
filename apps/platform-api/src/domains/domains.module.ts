import { Module } from '@nestjs/common';
import { DomainConfigModule } from '../config/domain-config.module';
import { DomainVerificationService } from './domain-verification.service';
import { DomainsService } from './domains.service';
import { TlsAskController } from './tls-ask.controller';

@Module({
  imports: [DomainConfigModule],
  controllers: [TlsAskController],
  providers: [DomainsService, DomainVerificationService],
  exports: [DomainsService],
})
export class DomainsModule {}
