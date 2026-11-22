import { Module } from '@nestjs/common';
import { ClientReviewsController } from './client-reviews.controller';
import { ClientReviewsService } from './client-reviews.service';
import { PublicClientReviewsController } from './public-client-reviews.controller';

@Module({
  controllers: [ClientReviewsController, PublicClientReviewsController],
  providers: [ClientReviewsService],
  exports: [ClientReviewsService],
})
export class ClientReviewsModule {}
