import { Module } from '@nestjs/common';
import { DomainConfigModule } from '../config/domain-config.module';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { CaptchaService } from './captcha.service';
import { SignupController } from './signup.controller';
import { SignupRateLimitService } from './signup-rate-limit.service';
import { SignupService } from './signup.service';

@Module({
  imports: [ProvisioningModule, DomainConfigModule],
  controllers: [SignupController],
  providers: [
    SignupService,
    CaptchaService,
    SignupRateLimitService,
  ],
  exports: [SignupService, SignupRateLimitService],
})
export class SignupModule {}
