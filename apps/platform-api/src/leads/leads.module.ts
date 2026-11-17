import { Module } from '@nestjs/common';
import { SignupModule } from '../signup/signup.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { PublicLeadsController } from './public-leads.controller';

@Module({
  // CaptchaService comes from SignupModule (verify-if-present, unlike
  // signup's fail-closed use). Prisma, mail, audit and the rate limiter
  // are all global modules.
  imports: [SignupModule],
  controllers: [LeadsController, PublicLeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
