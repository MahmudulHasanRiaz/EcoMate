import { Module } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { PlatformMailService } from './platform-mail.service';
import { SignupController } from './signup.controller';
import { SignupRateLimitService } from './signup-rate-limit.service';
import { SignupService } from './signup.service';

@Module({
  controllers: [SignupController],
  providers: [
    SignupService,
    CaptchaService,
    SignupRateLimitService,
    PlatformMailService,
  ],
  exports: [SignupService, SignupRateLimitService],
})
export class SignupModule {}
