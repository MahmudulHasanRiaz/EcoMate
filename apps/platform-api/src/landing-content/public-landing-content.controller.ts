import { Controller, Get, Header } from '@nestjs/common';
import { LandingContentService } from './landing-content.service';

/**
 * Public read for the SaaS landing. No auth; cacheable for 5 minutes
 * (content edits take at most 5 minutes to reach a cached reader — the
 * landing also falls back to built-in content when this endpoint is
 * unreachable, so a stale cache is never a broken page).
 */
@Controller('public/landing-content')
export class PublicLandingContentController {
  constructor(private readonly content: LandingContentService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  grouped() {
    return this.content.publicGrouped();
  }
}
