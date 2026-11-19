import { Module } from '@nestjs/common';
import { CaseStudiesController } from './case-studies.controller';
import { CaseStudiesService } from './case-studies.service';
import { PublicCaseStudiesController } from './public-case-studies.controller';

@Module({
  controllers: [CaseStudiesController, PublicCaseStudiesController],
  providers: [CaseStudiesService],
  exports: [CaseStudiesService],
})
export class CaseStudiesModule {}
