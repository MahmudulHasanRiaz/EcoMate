import { Controller, Get, Header } from '@nestjs/common';
import { ClientReviewsService } from './client-reviews.service';

/**
 * Public read for the SaaS landing home page. No auth; cacheable for
 * 5 minutes (the landing also falls back gracefully when this endpoint
 * is unreachable, so a stale cache is never a broken page). ONE
 * endpoint — the landing fetches once and splits by effectiveFormat
 * (video slider vs text grid); no `?format=` param, no detail endpoint
 * (reviews have no slugs — §3.3).
 */
@Controller('public/client-reviews')
export class PublicClientReviewsController {
  constructor(private readonly reviews: ClientReviewsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  list() {
    return this.reviews.publicList();
  }
}
