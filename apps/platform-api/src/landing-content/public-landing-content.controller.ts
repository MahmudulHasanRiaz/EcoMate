import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { LandingContentService } from './landing-content.service';

/** The legal documents the landing serves (sections legal.privacy / legal.terms). */
const LEGAL_DOCS = ['privacy', 'terms'] as const;

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

  /**
   * One legal document's managed blocks + latest update. Unknown docs
   * 404; unknown locales fall back to 'en' (the legal pages are
   * English-first — they have no locale context).
   */
  @Get('legal/:doc')
  @Header('Cache-Control', 'public, max-age=300')
  legal(
    @Param('doc') doc: string,
    @Query('locale') locale?: string,
  ) {
    if (!(LEGAL_DOCS as readonly string[]).includes(doc)) {
      throw new NotFoundException('Unknown legal document');
    }
    const resolvedLocale = locale === 'bn' ? 'bn' : 'en';
    return this.content.publicLegal(doc, resolvedLocale);
  }
}
