import { Module } from '@nestjs/common';
import { LandingCacheController } from './landing-cache.controller';
import { LandingCacheService } from './landing-cache.service';
import { LandingContentController } from './landing-content.controller';
import { LandingContentService } from './landing-content.service';
import { PublicLandingContentController } from './public-landing-content.controller';

@Module({
  controllers: [
    LandingContentController,
    PublicLandingContentController,
    LandingCacheController,
  ],
  providers: [LandingContentService, LandingCacheService],
  exports: [LandingContentService],
})
export class LandingContentModule {}
