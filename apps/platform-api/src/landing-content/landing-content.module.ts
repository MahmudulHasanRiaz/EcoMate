import { Module } from '@nestjs/common';
import { LandingContentController } from './landing-content.controller';
import { LandingContentService } from './landing-content.service';
import { PublicLandingContentController } from './public-landing-content.controller';

@Module({
  controllers: [LandingContentController, PublicLandingContentController],
  providers: [LandingContentService],
  exports: [LandingContentService],
})
export class LandingContentModule {}
