import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  // JobsModule exports BillingJobsService (billing jobs are an in-memory
  // registry, so search reads their last-run state from the service).
  // PrismaModule is @Global(), so no import is needed for the Prisma client.
  imports: [JobsModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
