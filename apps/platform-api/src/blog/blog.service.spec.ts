import { validate } from 'class-validator';
import { BlogService } from './blog.service';
import { effectiveStatus, isPubliclyVisible } from './blog.constants';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';

const NOW = new Date('2026-11-19T10:00:00.000Z');
const PAST = new Date('2026-11-18T10:00:00.000Z');
const FUTURE = new Date('2026-11-20T10:00:00.000Z');

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    titleEn: 'Hello World',
    titleBn: 'হ্যালো ওয়ার্ল্ড',
    slug: 'hello-world',
    excerptEn: null,
    excerptBn: null,
    contentEn: '<p>Hello world</p>',
    contentBn: '',
    author: 'EcoMate',
    categoryId: null,
    category: null,
    featuredImageUrl: null,
    videoUrl: null,
    galleryUrls: [],
    readTime: 1,
    status: 'published',
    publishedAt: PAST,
    seoTitleEn: null,
    seoTitleBn: null,
    seoDescEn: null,
    seoDescBn: null,
    canonicalUrl: null,
    deletedAt: null,
    createdAt: PAST,
    updatedAt: PAST,
    tags: [],
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    $transaction: jest
      .fn()
      .mockImplementation(async (arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    blogPost: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'post-1',
        createdAt: NOW,
        updatedAt: NOW,
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'post-1',
        ...data,
      })),
    },
    blogCategory: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'cat-1',
        createdAt: NOW,
        updatedAt: NOW,
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'cat-1',
        ...data,
      })),
      delete: jest.fn().mockResolvedValue({ id: 'cat-1' }),
    },
    blogTag: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'tag-1',
        createdAt: NOW,
        updatedAt: NOW,
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'tag-1',
        ...data,
      })),
      delete: jest.fn().mockResolvedValue({ id: 'tag-1' }),
    },
    blogPostTag: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    audit,
    service: new BlogService(prisma, audit as any),
  };
}

function validCreateDto(overrides: Record<string, unknown> = {}) {
  return {
    titleEn: 'Hello World',
    titleBn: 'হ্যালো ওয়ার্ল্ড',
    contentEn: '<p>Hello world</p>',
    ...overrides,
  } as CreateBlogPostDto;
}

describe('blog status helpers', () => {
  it('effectiveStatus: scheduled + due → published, scheduled + future → scheduled', () => {
    expect(
      effectiveStatus({ status: 'scheduled', publishedAt: PAST }, NOW),
    ).toBe('published');
    expect(
      effectiveStatus({ status: 'scheduled', publishedAt: FUTURE }, NOW),
    ).toBe('scheduled');
    expect(
      effectiveStatus({ status: 'scheduled', publishedAt: null }, NOW),
    ).toBe('scheduled');
    expect(
      effectiveStatus({ status: 'published', publishedAt: null }, NOW),
    ).toBe('published');
    expect(
      effectiveStatus({ status: 'draft', publishedAt: null }, NOW),
    ).toBe('draft');
    expect(
      effectiveStatus({ status: 'archived', publishedAt: PAST }, NOW),
    ).toBe('archived');
  });

  it('isPubliclyVisible: deleted posts are never visible, even when published', () => {
    expect(
      isPubliclyVisible(
        { status: 'published', publishedAt: PAST, deletedAt: null },
        NOW,
      ),
    ).toBe(true);
    expect(
      isPubliclyVisible(
        { status: 'published', publishedAt: PAST, deletedAt: PAST },
        NOW,
      ),
    ).toBe(false);
    expect(
      isPubliclyVisible(
        { status: 'scheduled', publishedAt: PAST, deletedAt: null },
        NOW,
      ),
    ).toBe(true);
    expect(
      isPubliclyVisible(
        { status: 'draft', publishedAt: null, deletedAt: null },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('BlogService.publicList / publicBySlug', () => {
  it('public list filters to live + effectively-published posts only', async () => {
    const { service, prisma } = makeService();
    await service.publicList({});
    const where = prisma.blogPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            deletedAt: null,
            OR: expect.arrayContaining([
              { status: 'published' },
              {
                status: 'scheduled',
                publishedAt: { lte: expect.any(Date) },
              },
            ]),
          }),
        ]),
      }),
    );
  });

  it('public list adds the computed effectiveStatus and paginates', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findMany.mockResolvedValue([
      makePost({ status: 'scheduled', publishedAt: PAST }),
    ]);
    prisma.blogPost.count.mockResolvedValue(1);
    const result = await service.publicList({ page: '1', limit: '20' });
    expect(result.data[0].effectiveStatus).toBe('published');
    expect(result.data[0].status).toBe('scheduled');
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('public list filters by category slug, tag slug and search', async () => {
    const { service, prisma } = makeService();
    await service.publicList({
      category: 'guides',
      tag: 'pos',
      search: 'hello',
    });
    const where = prisma.blogPost.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { category: { slug: 'guides' } },
        { tags: { some: { tag: { slug: 'pos' } } } },
        expect.objectContaining({ OR: expect.any(Array) }),
      ]),
    );
  });

  it('publicBySlug returns the post for a live published slug', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findFirst.mockResolvedValue(makePost());
    const post = await service.publicBySlug('hello-world');
    expect(post.slug).toBe('hello-world');
    expect(post.effectiveStatus).toBe('published');
  });

  it('publicBySlug 404s when nothing visible matches (draft/deleted/missing)', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findFirst.mockResolvedValue(null);
    await expect(service.publicBySlug('nope')).rejects.toThrow(
      'Blog post not found',
    );
    // The visibility predicate is part of the query itself — a draft
    // row can never leak through a missing-post check.
    expect(prisma.blogPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: 'nope',
          deletedAt: null,
        }),
      }),
    );
  });

  it('publicCategories only lists categories with a visible post', async () => {
    const { service, prisma } = makeService();
    prisma.blogCategory.findMany.mockResolvedValue([
      {
        id: 'cat-1',
        nameEn: 'Guides',
        nameBn: 'গাইড',
        slug: 'guides',
        parentId: null,
        sortOrder: 0,
        _count: { posts: 2 },
      },
    ]);
    const rows = await service.publicCategories();
    expect(rows).toEqual([
      expect.objectContaining({ slug: 'guides', postCount: 2 }),
    ]);
    expect(prisma.blogCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          posts: expect.objectContaining({ some: expect.any(Object) }),
        }),
      }),
    );
  });
});

describe('BlogService.create (posts)', () => {
  it('auto-generates the slug from titleEn and stamps publishedAt on publish', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findUnique.mockResolvedValue(
      makePost({ slug: 'hello-world', status: 'published' }),
    );
    const created = await service.create(
      validCreateDto({ status: 'published' }),
      'user-1',
    );
    const data = prisma.blogPost.create.mock.calls[0][0].data;
    expect(data.slug).toBe('hello-world');
    expect(data.status).toBe('published');
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect(data.readTime).toBe(1);
    expect(created.slug).toBe('hello-world');
    expect(prisma.blogPostTag.createMany).not.toHaveBeenCalled();
  });

  it('rejects a scheduled post without publishedAt', async () => {
    const { service } = makeService();
    await expect(
      service.create(validCreateDto({ status: 'scheduled' })),
    ).rejects.toThrow('needs a publish date');
  });

  it('409s on an explicit slug that a live post already uses', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findFirst.mockResolvedValue({ id: 'other-post' });
    await expect(
      service.create(validCreateDto({ slug: 'hello-world' })),
    ).rejects.toThrow('already uses this slug');
    // The clash check only counts LIVE posts (deletedAt null).
    expect(prisma.blogPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: 'hello-world',
          deletedAt: null,
        }),
      }),
    );
  });

  it('auto-slug appends -2 when the base slug is taken by a live post', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findFirst
      .mockResolvedValueOnce({ id: 'other-post' })
      .mockResolvedValueOnce(null);
    prisma.blogPost.findUnique.mockResolvedValue(
      makePost({ slug: 'hello-world-2' }),
    );
    await service.create(validCreateDto());
    expect(prisma.blogPost.create.mock.calls[0][0].data.slug).toBe(
      'hello-world-2',
    );
  });

  it('maps a P2002 race on the partial unique index to 409', async () => {
    const { service, prisma } = makeService();
    const err: any = new Error('Unique constraint failed');
    err.code = 'P2002';
    prisma.blogPost.create.mockRejectedValue(err);
    await expect(service.create(validCreateDto())).rejects.toThrow(
      'already uses this slug',
    );
  });

  it('400s on an unknown category or tag id', async () => {
    const { service, prisma } = makeService();
    prisma.blogCategory.findUnique.mockResolvedValue(null);
    await expect(
      service.create(validCreateDto({ categoryId: 'missing-cat' })),
    ).rejects.toThrow('Category not found');
    prisma.blogTag.findMany.mockResolvedValue([]);
    await expect(
      service.create(
        validCreateDto({ tagIds: ['00000000-0000-4000-8000-000000000001'] }),
      ),
    ).rejects.toThrow('Tag(s) not found');
  });

  it('attaches tags in the same transaction and audits the create', async () => {
    const { service, prisma, audit } = makeService();
    const tagId = '00000000-0000-4000-8000-000000000001';
    prisma.blogTag.findMany.mockResolvedValue([{ id: tagId }]);
    prisma.blogPost.findUnique.mockResolvedValue(makePost());
    await service.create(validCreateDto({ tagIds: [tagId] }), 'user-1');
    expect(prisma.blogPostTag.createMany).toHaveBeenCalledWith({
      data: [{ postId: 'post-1', tagId }],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'blog.post.create',
        entity: 'BlogPost',
        entityId: 'post-1',
      }),
    );
  });
});

describe('BlogService media (shared model + dual-write)', () => {
  it('dual-writes the legacy columns from the new media fields on create', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findUnique.mockResolvedValue(makePost());
    await service.create(
      validCreateDto({
        thumbnailUrl: 'https://cdn.example.com/hero.jpg',
        videos: [{ url: 'https://cdn.example.com/first.mp4' }],
        galleryImages: [
          { url: 'https://cdn.example.com/g1.jpg', alt: 'One' },
          { url: 'https://cdn.example.com/g2.jpg' },
        ],
      }),
    );
    const data = prisma.blogPost.create.mock.calls[0][0].data;
    expect(data.thumbnailUrl).toBe('https://cdn.example.com/hero.jpg');
    expect(data.videos).toEqual([
      { url: 'https://cdn.example.com/first.mp4' },
    ]);
    expect(data.featuredImageUrl).toBe('https://cdn.example.com/hero.jpg');
    expect(data.videoUrl).toBe('https://cdn.example.com/first.mp4');
    expect(data.galleryUrls).toEqual([
      'https://cdn.example.com/g1.jpg',
      'https://cdn.example.com/g2.jpg',
    ]);
  });

  it('derives the new media from legacy fields for an old client', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findUnique.mockResolvedValue(makePost());
    await service.create(
      validCreateDto({
        featuredImageUrl: 'https://cdn.example.com/legacy.jpg',
        videoUrl: 'https://www.youtube.com/watch?v=x',
        galleryUrls: ['https://cdn.example.com/g1.jpg'],
      }),
    );
    const data = prisma.blogPost.create.mock.calls[0][0].data;
    expect(data.thumbnailUrl).toBe('https://cdn.example.com/legacy.jpg');
    expect(data.videos).toEqual([
      { url: 'https://www.youtube.com/watch?v=x' },
    ]);
    expect(data.galleryImages).toEqual([
      { url: 'https://cdn.example.com/g1.jpg' },
    ]);
  });

  it('public list resolves media with legacy fallback on a pre-backfill row', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findMany.mockResolvedValue([
      makePost({
        featuredImageUrl: '/api/public/media/aaa',
        videoUrl: 'https://youtube.com/watch?v=x',
        galleryUrls: ['/api/public/media/bbb'],
      }),
    ]);
    prisma.blogPost.count.mockResolvedValue(1);
    const result = await service.publicList({});
    expect(result.data[0].thumbnailUrl).toBe('/api/public/media/aaa');
    expect(result.data[0].videos).toEqual([
      { url: 'https://youtube.com/watch?v=x' },
    ]);
    expect(result.data[0].galleryImages).toEqual([
      { url: '/api/public/media/bbb' },
    ]);
    // Legacy fields stay in the payload (additive).
    expect(result.data[0].featuredImageUrl).toBe('/api/public/media/aaa');
  });

  it('does not touch media columns on an unrelated update', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findUnique.mockResolvedValue(makePost());
    await service.update('post-1', { titleEn: 'Renamed' });
    const data = prisma.blogPost.update.mock.calls[0][0].data;
    expect(data.thumbnailUrl).toBeUndefined();
    expect(data.videos).toBeUndefined();
    expect(data.featuredImageUrl).toBeUndefined();
  });
});

describe('BlogService.update / remove (posts)', () => {
  it('404s on a missing or soft-deleted post', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findUnique.mockResolvedValue(null);
    await expect(service.update('x', { titleEn: 'New' })).rejects.toThrow(
      'Blog post not found',
    );
    prisma.blogPost.findUnique.mockResolvedValue(
      makePost({ deletedAt: PAST }),
    );
    await expect(service.update('x', { titleEn: 'New' })).rejects.toThrow(
      'Blog post not found',
    );
    await expect(service.remove('x')).rejects.toThrow(
      'Blog post not found',
    );
  });

  it('409s when renaming onto a live slug (excluding itself from the check)', async () => {
    const { service, prisma } = makeService();
    prisma.blogPost.findUnique.mockResolvedValue(makePost());
    prisma.blogPost.findFirst.mockResolvedValue({ id: 'other-post' });
    await expect(
      service.update('post-1', { slug: 'taken-slug' }),
    ).rejects.toThrow('already uses this slug');
    expect(prisma.blogPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: 'taken-slug',
          deletedAt: null,
          id: { not: 'post-1' },
        }),
      }),
    );
  });

  it('replaces tags wholesale and re-derives readTime on content change', async () => {
    const { service, prisma } = makeService();
    const tagId = '00000000-0000-4000-8000-000000000001';
    prisma.blogPost.findUnique.mockResolvedValue(makePost());
    prisma.blogTag.findMany.mockResolvedValue([{ id: tagId }]);
    const longContent = `<p>${'word '.repeat(450).trim()}</p>`;
    await service.update('post-1', {
      contentEn: longContent,
      tagIds: [tagId],
    });
    expect(prisma.blogPostTag.deleteMany).toHaveBeenCalledWith({
      where: { postId: 'post-1' },
    });
    expect(prisma.blogPostTag.createMany).toHaveBeenCalledWith({
      data: [{ postId: 'post-1', tagId }],
    });
    // 450 words / 200 wpm = 3 minutes.
    expect(prisma.blogPost.update.mock.calls[0][0].data.readTime).toBe(3);
  });

  it('remove soft-deletes (sets deletedAt, keeps the row) and audits', async () => {
    const { service, prisma, audit } = makeService();
    prisma.blogPost.findUnique.mockResolvedValue(makePost());
    const result = await service.remove('post-1', 'user-1');
    expect(result).toEqual({ deleted: true });
    expect(prisma.blogPost.update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'blog.post.delete',
        entity: 'BlogPost',
        entityId: 'post-1',
      }),
    );
  });

  it('a soft-deleted post frees its slug for a new post', async () => {
    // The slug-freed proof: after remove(), the live-slug check
    // (findFirst with deletedAt: null) finds nothing, so create()
    // with the same explicit slug succeeds instead of 409ing.
    const { service, prisma } = makeService();
    prisma.blogPost.findUnique
      .mockResolvedValueOnce(makePost({ slug: 'hello-world' }))
      .mockResolvedValue(makePost({ slug: 'hello-world' }));
    await service.remove('post-1', 'user-1');
    prisma.blogPost.findFirst.mockResolvedValue(null);
    const created = await service.create(
      validCreateDto({ slug: 'hello-world' }),
      'user-1',
    );
    expect(created.slug).toBe('hello-world');
    expect(prisma.blogPost.create.mock.calls[0][0].data.slug).toBe(
      'hello-world',
    );
  });
});

describe('BlogService.list (admin)', () => {
  it('hides deleted posts by default, shows them with includeDeleted', async () => {
    const { service, prisma } = makeService();
    await service.list({});
    expect(prisma.blogPost.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ deletedAt: null }),
    );
    await service.list({ includeDeleted: 'true' });
    expect(
      prisma.blogPost.findMany.mock.calls[1][0].where.deletedAt,
    ).toBeUndefined();
  });

  it('filters by stored status, category and tag', async () => {
    const { service, prisma } = makeService();
    await service.list({
      status: 'draft',
      categoryId: 'cat-1',
      tagId: 'tag-1',
    });
    expect(prisma.blogPost.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        status: 'draft',
        categoryId: 'cat-1',
        tags: { some: { tagId: 'tag-1' } },
      }),
    );
    // Unknown statuses are ignored, never passed to the DB.
    await service.list({ status: 'bogus' });
    expect(
      prisma.blogPost.findMany.mock.calls[1][0].where.status,
    ).toBeUndefined();
  });
});

describe('BlogService categories', () => {
  it('listCategories nests children under their parent', async () => {
    const { service, prisma } = makeService();
    prisma.blogCategory.findMany.mockResolvedValue([
      {
        id: 'root',
        nameEn: 'Root',
        parentId: null,
        sortOrder: 0,
        _count: { posts: 1 },
      },
      {
        id: 'child',
        nameEn: 'Child',
        parentId: 'root',
        sortOrder: 0,
        _count: { posts: 0 },
      },
      {
        id: 'grand',
        nameEn: 'Grand',
        parentId: 'child',
        sortOrder: 0,
        _count: { posts: 0 },
      },
    ]);
    const tree = await service.listCategories();
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('root');
    expect(tree[0].postCount).toBe(1);
    expect(tree[0].children[0].id).toBe('child');
    expect(tree[0].children[0].children[0].id).toBe('grand');
  });

  it('createCategory auto-slugs and 409s on an explicit slug clash', async () => {
    const { service, prisma } = makeService();
    await service.createCategory({ nameEn: 'Guides', nameBn: 'গাইড' });
    expect(prisma.blogCategory.create.mock.calls[0][0].data.slug).toBe(
      'guides',
    );
    prisma.blogCategory.findUnique.mockResolvedValue({ id: 'other' });
    await expect(
      service.createCategory({
        nameEn: 'Other',
        nameBn: 'অন্য',
        slug: 'guides',
      }),
    ).rejects.toThrow('already uses this slug');
  });

  it('updateCategory rejects self-parent and descendant-parent cycles', async () => {
    const { service, prisma } = makeService();
    prisma.blogCategory.findUnique.mockImplementation(
      async ({ where }: any) => {
        if (where.id === 'cat-1') {
          return { id: 'cat-1', parentId: null, slug: 'a', nameEn: 'A' };
        }
        if (where.id === 'child') {
          return { id: 'child', parentId: 'cat-1' };
        }
        return null;
      },
    );
    await expect(
      service.updateCategory('cat-1', { parentId: 'cat-1' }),
    ).rejects.toThrow('own parent');
    await expect(
      service.updateCategory('cat-1', { parentId: 'child' }),
    ).rejects.toThrow('own descendants');
  });

  it('deleteCategory hard-deletes and audits', async () => {
    const { service, prisma, audit } = makeService();
    prisma.blogCategory.findUnique.mockResolvedValue({
      id: 'cat-1',
      slug: 'guides',
      nameEn: 'Guides',
    });
    await service.deleteCategory('cat-1', 'user-1');
    expect(prisma.blogCategory.delete).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'blog.category.delete' }),
    );
  });
});

describe('BlogService tags', () => {
  it('create/update/delete with slug clash 409', async () => {
    const { service, prisma } = makeService();
    await service.createTag({ nameEn: 'POS', nameBn: 'পস' });
    expect(prisma.blogTag.create.mock.calls[0][0].data.slug).toBe('pos');
    prisma.blogTag.findUnique.mockResolvedValue({ id: 'other' });
    await expect(
      service.createTag({ nameEn: 'X', nameBn: 'এক্স', slug: 'pos' }),
    ).rejects.toThrow('already uses this slug');
    prisma.blogTag.findUnique.mockResolvedValue({
      id: 'tag-1',
      slug: 'old',
      nameEn: 'Old',
    });
    await expect(
      service.updateTag('tag-1', { slug: 'pos' }),
    ).rejects.toThrow('already uses this slug');
  });

  it('deleteTag hard-deletes and audits', async () => {
    const { service, prisma, audit } = makeService();
    prisma.blogTag.findUnique.mockResolvedValue({
      id: 'tag-1',
      slug: 'pos',
      nameEn: 'POS',
    });
    await service.deleteTag('tag-1', 'user-1');
    expect(prisma.blogTag.delete).toHaveBeenCalledWith({
      where: { id: 'tag-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'blog.tag.delete' }),
    );
  });
});

describe('CreateBlogPostDto validation', () => {
  it('rejects a bad slug and a bad status, accepts a valid DTO', async () => {
    const badSlug = Object.assign(new CreateBlogPostDto(), {
      titleEn: 'T',
      titleBn: 'টি',
      contentEn: '<p>x</p>',
      slug: 'Bad Slug!',
    });
    expect((await validate(badSlug)).length).toBeGreaterThan(0);
    const badStatus = Object.assign(new CreateBlogPostDto(), {
      titleEn: 'T',
      titleBn: 'টি',
      contentEn: '<p>x</p>',
      status: 'live',
    });
    expect((await validate(badStatus)).length).toBeGreaterThan(0);
    const good = Object.assign(new CreateBlogPostDto(), {
      titleEn: 'T',
      titleBn: 'টি',
      contentEn: '<p>x</p>',
      slug: 't-post',
      status: 'draft',
    });
    expect(await validate(good)).toEqual([]);
  });
});
