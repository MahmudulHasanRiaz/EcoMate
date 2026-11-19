import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BlogService } from './blog.service';
import {
  CreateBlogCategoryDto,
  UpdateBlogCategoryDto,
} from './dto/blog-category.dto';
import {
  CreateBlogTagDto,
  UpdateBlogTagDto,
} from './dto/blog-tag.dto';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';

/**
 * Operator CRUD for the blog (Landing CMS Batch 2, item 20). Reads
 * follow the platform READ_ROLES convention; writes are
 * SUPERADMIN/BILLING only (same as landing-content writes — blog
 * changes reach the public site). All writes are audited.
 *
 * NOTE on route order: the static 'categories' / 'tags' routes are
 * declared BEFORE ':id' so /blog/categories never falls into the
 * :id param route.
 */
@Controller('blog')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  // ── posts ─────────────────────────────────────────────────────────

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('tagId') tagId?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    return this.blog.list({
      page,
      limit,
      status,
      search,
      categoryId,
      tagId,
      includeDeleted,
    });
  }

  @Post()
  @Roles('SUPERADMIN', 'BILLING')
  create(
    @Body() dto: CreateBlogPostDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.blog.create(dto, user?.id);
  }

  // ── categories (before ':id') ─────────────────────────────────────

  @Get('categories')
  @Roles(...READ_ROLES)
  listCategories() {
    return this.blog.listCategories();
  }

  @Post('categories')
  @Roles('SUPERADMIN', 'BILLING')
  createCategory(
    @Body() dto: CreateBlogCategoryDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.blog.createCategory(dto, user?.id);
  }

  @Patch('categories/:id')
  @Roles('SUPERADMIN', 'BILLING')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlogCategoryDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.blog.updateCategory(id, dto, user?.id);
  }

  @Delete('categories/:id')
  @Roles('SUPERADMIN', 'BILLING')
  deleteCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.blog.deleteCategory(id, user?.id);
  }

  // ── tags (before ':id') ───────────────────────────────────────────

  @Get('tags')
  @Roles(...READ_ROLES)
  listTags() {
    return this.blog.listTags();
  }

  @Post('tags')
  @Roles('SUPERADMIN', 'BILLING')
  createTag(
    @Body() dto: CreateBlogTagDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.blog.createTag(dto, user?.id);
  }

  @Patch('tags/:id')
  @Roles('SUPERADMIN', 'BILLING')
  updateTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlogTagDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.blog.updateTag(id, dto, user?.id);
  }

  @Delete('tags/:id')
  @Roles('SUPERADMIN', 'BILLING')
  deleteTag(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.blog.deleteTag(id, user?.id);
  }

  // ── single post (after the static routes) ─────────────────────────

  @Get(':id')
  @Roles(...READ_ROLES)
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.getOne(id);
  }

  @Patch(':id')
  @Roles('SUPERADMIN', 'BILLING')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlogPostDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.blog.update(id, dto, user?.id);
  }

  /** Soft delete — the post's slug is freed for reuse. */
  @Delete(':id')
  @Roles('SUPERADMIN', 'BILLING')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.blog.remove(id, user?.id);
  }
}
