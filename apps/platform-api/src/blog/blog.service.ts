import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import {
  deriveLegacyMedia,
  hasMediaInput,
  previousMediaOf,
  resolveMediaWithLegacyFallback,
  resolveMediaWrite,
} from '../common/media/media.service-helpers';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  BLOG_POST_STATUSES,
  effectiveStatus,
  readTimeFromContent,
  slugify,
} from './blog.constants';
import { CreateBlogCategoryDto, UpdateBlogCategoryDto } from './dto/blog-category.dto';
import { CreateBlogTagDto, UpdateBlogTagDto } from './dto/blog-tag.dto';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';

/**
 * Blog (Landing CMS Batch 2, item 20): admin CRUD for posts +
 * categories + tags, and the public read layer for the landing.
 *
 * Slug rule (see schema.prisma): post slugs are unique among LIVE
 * posts only — a soft-deleted post frees its slug. The partial unique
 * index in the migration enforces it at the DB layer; this service
 * checks clashes in code first (409) and maps a P2002 race to 409.
 *
 * Publish rule: a post is publicly visible iff it is live and
 * effectively published — status 'published', or status 'scheduled'
 * with publishedAt <= now (on-read publish check, no cron). The
 * stored status never changes on read.
 */
@Injectable()
export class BlogService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── shared helpers ────────────────────────────────────────────────

  /** Prisma visibility predicate for public reads (live + effectively published). */
  private visibilityWhere(now: Date) {
    return {
      deletedAt: null,
      OR: [
        { status: 'published' },
        { status: 'scheduled', publishedAt: { lte: now } },
      ],
    };
  }

  private postInclude() {
    return {
      category: true,
      tags: { include: { tag: true }, orderBy: { tag: { nameEn: 'asc' } } },
    } as const;
  }

  /**
   * Wire shape: flattened tags + computed effectiveStatus + resolved
   * media (new fields win, legacy fallback — §4.3). The legacy fields
   * stay in the payload (additive — the old landing ignores the new
   * keys); nothing is removed from a public payload in this build.
   */
  private toPostWire(post: any) {
    const { tags, ...rest } = post;
    return {
      ...rest,
      ...resolveMediaWithLegacyFallback(post),
      tags: (tags ?? []).map((link: any) => link.tag),
      effectiveStatus: effectiveStatus(post),
    };
  }

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.blogCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new BadRequestException('Category not found');
    }
    return category;
  }

  private async assertTagsExist(tagIds: string[]) {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return [];
    const found = await this.prisma.blogTag.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      const missing = unique.filter(
        (id) => !found.some((row: any) => row.id === id),
      );
      throw new BadRequestException(
        `Tag(s) not found: ${missing.join(', ')}`,
      );
    }
    return unique;
  }

  /** Live-slug clash check (soft-deleted posts don't count). */
  private async assertLiveSlugFree(slug: string, excludeId?: string) {
    const clash = await this.prisma.blogPost.findFirst({
      where: {
        slug,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'A live blog post already uses this slug',
      );
    }
  }

  /** Auto-slug from a title, with a -2, -3, … suffix until free. */
  private async uniqueAutoSlug(titleEn: string): Promise<string> {
    const base = slugify(titleEn) || 'post';
    let candidate = base;
    let suffix = 2;
    while (
      await this.prisma.blogPost.findFirst({
        where: { slug: candidate, deletedAt: null },
        select: { id: true },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private async uniqueCategorySlug(nameEn: string): Promise<string> {
    const base = slugify(nameEn) || 'category';
    let candidate = base;
    let suffix = 2;
    while (
      await this.prisma.blogCategory.findUnique({
        where: { slug: candidate },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private async uniqueTagSlug(nameEn: string): Promise<string> {
    const base = slugify(nameEn) || 'tag';
    let candidate = base;
    let suffix = 2;
    while (
      await this.prisma.blogTag.findUnique({ where: { slug: candidate } })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private isUniqueViolation(err: any): boolean {
    return err?.code === 'P2002';
  }

  // ── public reads ──────────────────────────────────────────────────

  /**
   * Public list for the landing archive: published only, newest
   * publish date first. Filter by category/tag slug, free-text search
   * over titles + excerpts. Empty table → empty page, never an error
   * (the landing fails soft on top of that).
   */
  async publicList(query: {
    page?: string;
    limit?: string;
    category?: string;
    tag?: string;
    search?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const now = new Date();
    const and: any[] = [this.visibilityWhere(now)];
    if (query.category) {
      and.push({ category: { slug: query.category } });
    }
    if (query.tag) {
      and.push({ tags: { some: { tag: { slug: query.tag } } } });
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      and.push({
        OR: [
          { titleEn: { contains: q, mode: 'insensitive' } },
          { titleBn: { contains: q, mode: 'insensitive' } },
          { excerptEn: { contains: q, mode: 'insensitive' } },
          { excerptBn: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where = { AND: and };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        include: this.postInclude(),
        orderBy: [
          { publishedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return {
      data: data.map((post: any) => this.toPostWire(post)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** Public detail by slug: published only, 404 otherwise. */
  async publicBySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, ...this.visibilityWhere(new Date()) },
      include: this.postInclude(),
    });
    if (!post) throw new NotFoundException('Blog post not found');
    return this.toPostWire(post);
  }

  /**
   * Public categories for the archive filter chips: only categories
   * with at least one visible post, with the visible-post count each.
   */
  async publicCategories() {
    const now = new Date();
    const visible = this.visibilityWhere(now);
    const rows = await this.prisma.blogCategory.findMany({
      where: { posts: { some: visible } },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      select: {
        id: true,
        nameEn: true,
        nameBn: true,
        slug: true,
        parentId: true,
        sortOrder: true,
        _count: { select: { posts: { where: visible } } },
      },
    });
    return rows.map((row: any) => ({
      id: row.id,
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      slug: row.slug,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      postCount: row._count.posts,
    }));
  }

  // ── admin: posts ──────────────────────────────────────────────────

  async list(query: {
    page?: string;
    limit?: string;
    status?: string;
    search?: string;
    categoryId?: string;
    tagId?: string;
    includeDeleted?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const where: any = {};
    // Deleted posts are hidden by default; includeDeleted=true shows
    // them (with deletedAt set) for operator visibility. There is no
    // restore endpoint — a deleted post stays deleted.
    if (query.includeDeleted !== 'true') where.deletedAt = null;
    if (
      query.status &&
      (BLOG_POST_STATUSES as readonly string[]).includes(query.status)
    ) {
      where.status = query.status;
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.tagId) {
      where.tags = { some: { tagId: query.tagId } };
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { titleEn: { contains: q, mode: 'insensitive' } },
        { titleBn: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        include: this.postInclude(),
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return {
      data: data.map((post: any) => this.toPostWire(post)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** Admin single-post read (includes soft-deleted posts). */
  async getOne(id: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { id },
      include: this.postInclude(),
    });
    if (!post) throw new NotFoundException('Blog post not found');
    return this.toPostWire(post);
  }

  async create(dto: CreateBlogPostDto, actorId?: string) {
    const status = dto.status ?? 'draft';
    if (status === 'scheduled' && !dto.publishedAt) {
      throw new BadRequestException(
        'A scheduled post needs a publish date (publishedAt)',
      );
    }
    if (dto.categoryId) await this.assertCategoryExists(dto.categoryId);
    const tagIds = dto.tagIds
      ? await this.assertTagsExist(dto.tagIds)
      : [];
    let slug: string;
    if (dto.slug) {
      await this.assertLiveSlugFree(dto.slug);
      slug = dto.slug;
    } else {
      slug = await this.uniqueAutoSlug(dto.titleEn);
    }
    const publishedAt =
      status === 'published' && !dto.publishedAt
        ? new Date()
        : (dto.publishedAt ?? null);
    const readTime =
      dto.readTime ?? readTimeFromContent(dto.contentEn);
    // Media: new fields win; a legacy-only DTO derives them; the
    // legacy columns are dual-written from the resolved media (§4.3).
    const media = resolveMediaWrite(dto);
    const legacy = deriveLegacyMedia(media);
    try {
      const post = await this.prisma.$transaction(async (tx: any) => {
        const created = await tx.blogPost.create({
          data: {
            titleEn: dto.titleEn,
            titleBn: dto.titleBn,
            slug,
            excerptEn: dto.excerptEn ?? null,
            excerptBn: dto.excerptBn ?? null,
            contentEn: dto.contentEn,
            contentBn: dto.contentBn ?? '',
            author: dto.author ?? '',
            categoryId: dto.categoryId ?? null,
            ...media,
            featuredImageUrl: legacy.featuredImageUrl,
            videoUrl: legacy.videoUrl,
            galleryUrls: legacy.galleryUrls,
            readTime,
            status,
            publishedAt,
            seoTitleEn: dto.seoTitleEn ?? null,
            seoTitleBn: dto.seoTitleBn ?? null,
            seoDescEn: dto.seoDescEn ?? null,
            seoDescBn: dto.seoDescBn ?? null,
            canonicalUrl: dto.canonicalUrl ?? null,
          },
          include: this.postInclude(),
        });
        if (tagIds.length > 0) {
          await tx.blogPostTag.createMany({
            data: tagIds.map((tagId) => ({ postId: created.id, tagId })),
          });
        }
        return created;
      });
      await this.audit.record({
        actorId,
        action: 'blog.post.create',
        entity: 'BlogPost',
        entityId: post.id,
        after: { slug: post.slug, status: post.status, titleEn: post.titleEn },
      });
      // Re-read so the response carries the attached tags.
      return this.getOne(post.id);
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(
          'A live blog post already uses this slug',
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateBlogPostDto, actorId?: string) {
    const existing = await this.prisma.blogPost.findUnique({
      where: { id },
      include: this.postInclude(),
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Blog post not found');
    }
    const nextStatus = dto.status ?? existing.status;
    const nextPublishedAt =
      dto.publishedAt !== undefined
        ? dto.publishedAt
        : existing.publishedAt;
    if (nextStatus === 'scheduled' && !nextPublishedAt) {
      throw new BadRequestException(
        'A scheduled post needs a publish date (publishedAt)',
      );
    }
    if (dto.categoryId) await this.assertCategoryExists(dto.categoryId);
    const tagIds =
      dto.tagIds !== undefined
        ? await this.assertTagsExist(dto.tagIds)
        : undefined;
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      await this.assertLiveSlugFree(dto.slug, id);
    }
    const data: Record<string, unknown> = {};
    if (dto.titleEn !== undefined) data.titleEn = dto.titleEn;
    if (dto.titleBn !== undefined) data.titleBn = dto.titleBn;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.excerptEn !== undefined) data.excerptEn = dto.excerptEn;
    if (dto.excerptBn !== undefined) data.excerptBn = dto.excerptBn;
    if (dto.contentEn !== undefined) data.contentEn = dto.contentEn;
    if (dto.contentBn !== undefined) data.contentBn = dto.contentBn;
    if (dto.author !== undefined) data.author = dto.author;
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (hasMediaInput(dto)) {
      // Media + legacy columns move together, normalized against the
      // stored row (video→image rescue, grandfathering — §6.3).
      const media = resolveMediaWrite(dto, previousMediaOf(existing));
      const legacy = deriveLegacyMedia(media);
      Object.assign(data, media, {
        featuredImageUrl: legacy.featuredImageUrl,
        videoUrl: legacy.videoUrl,
        galleryUrls: legacy.galleryUrls,
      });
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.publishedAt !== undefined) data.publishedAt = dto.publishedAt;
    if (dto.seoTitleEn !== undefined) data.seoTitleEn = dto.seoTitleEn;
    if (dto.seoTitleBn !== undefined) data.seoTitleBn = dto.seoTitleBn;
    if (dto.seoDescEn !== undefined) data.seoDescEn = dto.seoDescEn;
    if (dto.seoDescBn !== undefined) data.seoDescBn = dto.seoDescBn;
    if (dto.canonicalUrl !== undefined) data.canonicalUrl = dto.canonicalUrl;
    // Publishing without a date stamps now (same as create).
    if (
      nextStatus === 'published' &&
      !nextPublishedAt &&
      dto.publishedAt === undefined
    ) {
      data.publishedAt = new Date();
    }
    // Read time: explicit value wins; null re-derives from content;
    // a content change without an explicit value re-derives too.
    if (dto.readTime !== undefined) {
      data.readTime =
        dto.readTime ??
        readTimeFromContent(dto.contentEn ?? existing.contentEn);
    } else if (
      dto.contentEn !== undefined &&
      dto.contentEn !== existing.contentEn
    ) {
      data.readTime = readTimeFromContent(dto.contentEn);
    }
    try {
      await this.prisma.$transaction(async (tx: any) => {
        await tx.blogPost.update({ where: { id }, data });
        if (tagIds !== undefined) {
          await tx.blogPostTag.deleteMany({ where: { postId: id } });
          if (tagIds.length > 0) {
            await tx.blogPostTag.createMany({
              data: tagIds.map((tagId) => ({ postId: id, tagId })),
            });
          }
        }
      });
      const updated = await this.getOne(id);
      await this.audit.record({
        actorId,
        action: 'blog.post.update',
        entity: 'BlogPost',
        entityId: id,
        before: {
          slug: existing.slug,
          status: existing.status,
          titleEn: existing.titleEn,
        },
        after: {
          slug: updated.slug,
          status: updated.status,
          titleEn: updated.titleEn,
        },
      });
      return updated;
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(
          'A live blog post already uses this slug',
        );
      }
      throw err;
    }
  }

  /** Soft delete — the slug is freed for reuse (see the header comment). */
  async remove(id: string, actorId?: string) {
    const existing = await this.prisma.blogPost.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Blog post not found');
    }
    await this.prisma.blogPost.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: 'blog.post.delete',
      entity: 'BlogPost',
      entityId: id,
      before: {
        slug: existing.slug,
        status: existing.status,
        titleEn: existing.titleEn,
      },
    });
    return { deleted: true };
  }

  // ── admin: categories ─────────────────────────────────────────────

  /** Full category tree (roots first, children nested, sortOrder then name). */
  async listCategories() {
    const rows = await this.prisma.blogCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      include: {
        _count: {
          select: { posts: { where: { deletedAt: null } } },
        },
      },
    });
    const byId = new Map<string, any>();
    for (const row of rows) {
      byId.set(row.id, {
        ...row,
        postCount: row._count.posts,
        children: [],
      });
    }
    const roots: any[] = [];
    for (const row of rows) {
      const node = byId.get(row.id);
      if (row.parentId && byId.has(row.parentId)) {
        byId.get(row.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async createCategory(dto: CreateBlogCategoryDto, actorId?: string) {
    if (dto.parentId) await this.assertCategoryExists(dto.parentId);
    const slug = dto.slug
      ? dto.slug
      : await this.uniqueCategorySlug(dto.nameEn);
    if (dto.slug) {
      const clash = await this.prisma.blogCategory.findUnique({
        where: { slug },
      });
      if (clash) {
        throw new ConflictException(
          'A blog category already uses this slug',
        );
      }
    }
    try {
      const row = await this.prisma.blogCategory.create({
        data: {
          nameEn: dto.nameEn,
          nameBn: dto.nameBn,
          descEn: dto.descEn ?? null,
          descBn: dto.descBn ?? null,
          slug,
          parentId: dto.parentId ?? null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.audit.record({
        actorId,
        action: 'blog.category.create',
        entity: 'BlogCategory',
        entityId: row.id,
        after: { slug: row.slug, nameEn: row.nameEn },
      });
      return row;
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(
          'A blog category already uses this slug',
        );
      }
      throw err;
    }
  }

  async updateCategory(
    id: string,
    dto: UpdateBlogCategoryDto,
    actorId?: string,
  ) {
    const existing = await this.prisma.blogCategory.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Blog category not found');
    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException(
          'A category cannot be its own parent',
        );
      }
      await this.assertCategoryExists(dto.parentId);
      // Cycle guard: walk up from the new parent — if we reach this
      // category, the new parent is one of its descendants.
      let cursor: string | null = dto.parentId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) {
          throw new BadRequestException(
            'A category cannot move under one of its own descendants',
          );
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const parent = await this.prisma.blogCategory.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = parent?.parentId ?? null;
      }
    }
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      const clash = await this.prisma.blogCategory.findUnique({
        where: { slug: dto.slug },
      });
      if (clash) {
        throw new ConflictException(
          'A blog category already uses this slug',
        );
      }
    }
    const data: Record<string, unknown> = {};
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn;
    if (dto.nameBn !== undefined) data.nameBn = dto.nameBn;
    if (dto.descEn !== undefined) data.descEn = dto.descEn;
    if (dto.descBn !== undefined) data.descBn = dto.descBn;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.parentId !== undefined) data.parentId = dto.parentId;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    try {
      const updated = await this.prisma.blogCategory.update({
        where: { id },
        data,
      });
      await this.audit.record({
        actorId,
        action: 'blog.category.update',
        entity: 'BlogCategory',
        entityId: id,
        before: { slug: existing.slug, nameEn: existing.nameEn },
        after: { slug: updated.slug, nameEn: updated.nameEn },
      });
      return updated;
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(
          'A blog category already uses this slug',
        );
      }
      throw err;
    }
  }

  /**
   * Hard delete. Children become roots and posts lose the category
   * (both SetNull at the FK) — nothing else is deleted.
   */
  async deleteCategory(id: string, actorId?: string) {
    const existing = await this.prisma.blogCategory.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Blog category not found');
    await this.prisma.blogCategory.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'blog.category.delete',
      entity: 'BlogCategory',
      entityId: id,
      before: { slug: existing.slug, nameEn: existing.nameEn },
    });
    return { deleted: true };
  }

  // ── admin: tags ───────────────────────────────────────────────────

  async listTags() {
    const rows = await this.prisma.blogTag.findMany({
      orderBy: [{ nameEn: 'asc' }],
      include: {
        _count: {
          select: { posts: { where: { post: { deletedAt: null } } } },
        },
      },
    });
    return rows.map((row: any) => ({
      ...row,
      postCount: row._count.posts,
    }));
  }

  async createTag(dto: CreateBlogTagDto, actorId?: string) {
    const slug = dto.slug
      ? dto.slug
      : await this.uniqueTagSlug(dto.nameEn);
    if (dto.slug) {
      const clash = await this.prisma.blogTag.findUnique({
        where: { slug },
      });
      if (clash) {
        throw new ConflictException('A blog tag already uses this slug');
      }
    }
    try {
      const row = await this.prisma.blogTag.create({
        data: { nameEn: dto.nameEn, nameBn: dto.nameBn, slug },
      });
      await this.audit.record({
        actorId,
        action: 'blog.tag.create',
        entity: 'BlogTag',
        entityId: row.id,
        after: { slug: row.slug, nameEn: row.nameEn },
      });
      return row;
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('A blog tag already uses this slug');
      }
      throw err;
    }
  }

  async updateTag(id: string, dto: UpdateBlogTagDto, actorId?: string) {
    const existing = await this.prisma.blogTag.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Blog tag not found');
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      const clash = await this.prisma.blogTag.findUnique({
        where: { slug: dto.slug },
      });
      if (clash) {
        throw new ConflictException('A blog tag already uses this slug');
      }
    }
    const data: Record<string, unknown> = {};
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn;
    if (dto.nameBn !== undefined) data.nameBn = dto.nameBn;
    if (dto.slug !== undefined) data.slug = dto.slug;
    try {
      const updated = await this.prisma.blogTag.update({
        where: { id },
        data,
      });
      await this.audit.record({
        actorId,
        action: 'blog.tag.update',
        entity: 'BlogTag',
        entityId: id,
        before: { slug: existing.slug, nameEn: existing.nameEn },
        after: { slug: updated.slug, nameEn: updated.nameEn },
      });
      return updated;
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('A blog tag already uses this slug');
      }
      throw err;
    }
  }

  /** Hard delete — post links cascade (BlogPostTag onDelete Cascade). */
  async deleteTag(id: string, actorId?: string) {
    const existing = await this.prisma.blogTag.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Blog tag not found');
    await this.prisma.blogTag.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'blog.tag.delete',
      entity: 'BlogTag',
      entityId: id,
      before: { slug: existing.slug, nameEn: existing.nameEn },
    });
    return { deleted: true };
  }
}
