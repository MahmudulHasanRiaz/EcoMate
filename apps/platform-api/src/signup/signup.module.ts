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
  // CaptchaService is exported for the leads module: lead capture verifies
  // a Turnstile token only when one is provided (verify-if-present), unlike
  // signup which fails closed.
  exports: [SignupService, SignupRateLimitService, CaptchaService],
})
export class SignupModule {}
