import { Controller, Get, Header, Param } from '@nestjs/common';
import { CaseStudiesService } from './case-studies.service';

/**
 * Public reads for the SaaS landing. No auth; cacheable for 5 minutes
 * (the landing also falls back gracefully when this endpoint is
 * unreachable, so a stale cache is never a broken page). Published
 * studies only — the service 404s unpublished slugs.
 */
@Controller('public/case-studies')
export class PublicCaseStudiesController {
  constructor(private readonly studies: CaseStudiesService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  list() {
    return this.studies.publicList();
  }

  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=300')
  bySlug(@Param('slug') slug: string) {
    return this.studies.publicBySlug(slug);
  }
}
