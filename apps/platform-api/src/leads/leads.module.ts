import { Module } from '@nestjs/common';
import { AdDispatchModule } from '../ad-dispatch/ad-dispatch.module';
import { SignupModule } from '../signup/signup.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { PublicLeadsController } from './public-leads.controller';

@Module({
  // CaptchaService comes from SignupModule (verify-if-present, unlike
  // signup's fail-closed use). Prisma, mail, audit and the rate limiter
  // are all global modules. AdDispatchModule feeds the instant /
  // validated dispatch triggers in LeadsService (CMS batch 2, item 21).
  imports: [SignupModule, AdDispatchModule],
  controllers: [LeadsController, PublicLeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
