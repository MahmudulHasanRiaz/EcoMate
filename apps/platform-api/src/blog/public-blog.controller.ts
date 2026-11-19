import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { BlogService } from './blog.service';

/**
 * Public read for the SaaS landing blog. No auth; cacheable for 5
 * minutes (a publish takes at most 5 minutes to reach a cached
 * reader — the landing also falls back to an empty blog when this
 * endpoint is unreachable, so a stale cache is never a broken page).
 * Only effectively-published posts are ever served (see BlogService).
 *
 * NOTE on route order: the static 'categories' route is declared
 * BEFORE ':slug' so /public/blog/categories never falls into the
 * slug param route.
 */
@Controller('public/blog')
export class PublicBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
  ) {
    return this.blog.publicList({ page, limit, category, tag, search });
  }

  /** Categories with at least one visible post (archive filter chips). */
  @Get('categories')
  @Header('Cache-Control', 'public, max-age=300')
  categories() {
    return this.blog.publicCategories();
  }

  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=300')
  bySlug(@Param('slug') slug: string) {
    return this.blog.publicBySlug(slug);
  }
}
