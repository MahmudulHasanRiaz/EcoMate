/**
 * Public blog reads (Landing CMS Batch 2, item 20).
 *
 * The console edits blog posts; the landing fetches them from
 * GET /public/blog (server-side, 5-minute revalidate). Every fetch
 * here never throws: API down, empty DB, or malformed rows all fall
 * back to the empty state — the blog pages never break.
 *
 * Content is Tiptap HTML (console editor). It is sanitized here, at
 * fetch time, with isomorphic-dompurify — the pages render the
 * already-sanitized HTML. Server-side only: never import this module
 * from a client component (jsdom must not reach the browser bundle).
 */
import DOMPurify from 'isomorphic-dompurify';
import {
  normalizeMedia,
  type ContentMedia,
} from './content-media';

export interface PublicBlogCategory {
  id: string;
  nameEn: string;
  nameBn: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  postCount: number;
}

export interface PublicBlogTag {
  id: string;
  nameEn: string;
  nameBn: string;
  slug: string;
}

export interface PublicBlogPost extends ContentMedia {
  id: string;
  titleEn: string;
  titleBn: string;
  slug: string;
  excerptEn: string | null;
  excerptBn: string | null;
  /** Sanitized HTML (see sanitizeBlogHtml). */
  contentEn: string;
  /** Sanitized HTML (see sanitizeBlogHtml). */
  contentBn: string;
  author: string;
  category: {
    id: string;
    nameEn: string;
    nameBn: string;
    slug: string;
  } | null;
  /** @deprecated — legacy media columns; readers use resolveMedia(). */
  featuredImageUrl: string | null;
  /** @deprecated — legacy media columns; readers use resolveMedia(). */
  videoUrl: string | null;
  /** @deprecated — legacy media columns; readers use resolveMedia(). */
  galleryUrls: string[];
  readTime: number | null;
  status: string;
  effectiveStatus: string;
  publishedAt: string | null;
  seoTitleEn: string | null;
  seoTitleBn: string | null;
  seoDescEn: string | null;
  seoDescBn: string | null;
  canonicalUrl: string | null;
  tags: PublicBlogTag[];
  createdAt: string;
  updatedAt: string;
}

export interface BlogListPage {
  data: PublicBlogPost[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export const EMPTY_BLOG_LIST: BlogListPage = {
  data: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
};

function platformApiBase(): string {
  const configured = (
    process.env.PLATFORM_API_URL || 'http://localhost:4100/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Sanitize Tiptap HTML for public rendering. DOMPurify's defaults
 * strip scripts, event handlers, and dangerous URLs; the config adds
 * the tags/attrs Tiptap emits (tables, alignment, images) and forbids
 * iframes — video embeds come from the post's videoUrl field, never
 * from pasted content.
 */
export function sanitizeBlogHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['iframe', 'form', 'input', 'button', 'style', 'script'],
    FORBID_ATTR: ['style', 'onerror', 'onclick'],
  });
}

/** Normalize one raw API post row into the public shape (never throws). */
function normalizePost(raw: unknown): PublicBlogPost | null {
  if (!isRecord(raw)) return null;
  const slug = asString(raw.slug);
  const titleEn = asString(raw.titleEn);
  if (!slug || !titleEn) return null;
  const category = isRecord(raw.category)
    ? {
        id: asString(raw.category.id) ?? '',
        nameEn: asString(raw.category.nameEn) ?? '',
        nameBn: asString(raw.category.nameBn) ?? '',
        slug: asString(raw.category.slug) ?? '',
      }
    : null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter(isRecord)
        .map((tag) => ({
          id: asString(tag.id) ?? '',
          nameEn: asString(tag.nameEn) ?? '',
          nameBn: asString(tag.nameBn) ?? '',
          slug: asString(tag.slug) ?? '',
        }))
        .filter((tag) => tag.slug.length > 0)
    : [];
  // The six media fields normalize leniently: a row from an older
  // API (no new fields) degrades to empty media and still renders
  // from its legacy columns via resolveMedia() (§4.5).
  const media = normalizeMedia(raw);
  return {
    id: asString(raw.id) ?? '',
    titleEn,
    titleBn: asString(raw.titleBn) ?? '',
    slug,
    excerptEn: asString(raw.excerptEn),
    excerptBn: asString(raw.excerptBn),
    contentEn: sanitizeBlogHtml(asString(raw.contentEn) ?? ''),
    contentBn: sanitizeBlogHtml(asString(raw.contentBn) ?? ''),
    author: asString(raw.author) ?? '',
    category: category && category.slug ? category : null,
    featuredImageUrl: asString(raw.featuredImageUrl),
    videoUrl: asString(raw.videoUrl),
    galleryUrls: asStringArray(raw.galleryUrls),
    ...media,
    readTime:
      typeof raw.readTime === 'number' && Number.isFinite(raw.readTime)
        ? raw.readTime
        : null,
    status: asString(raw.status) ?? 'published',
    effectiveStatus: asString(raw.effectiveStatus) ?? 'published',
    publishedAt: asString(raw.publishedAt),
    seoTitleEn: asString(raw.seoTitleEn),
    seoTitleBn: asString(raw.seoTitleBn),
    seoDescEn: asString(raw.seoDescEn),
    seoDescBn: asString(raw.seoDescBn),
    canonicalUrl: asString(raw.canonicalUrl),
    tags,
    createdAt: asString(raw.createdAt) ?? '',
    updatedAt: asString(raw.updatedAt) ?? '',
  };
}

export async function fetchBlogPosts(query: {
  page?: number;
  limit?: number;
  category?: string;
  tag?: string;
  search?: string;
} = {}): Promise<BlogListPage> {
  try {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    if (query.category) params.set('category', query.category);
    if (query.tag) params.set('tag', query.tag);
    if (query.search) params.set('search', query.search);
    const qs = params.toString();
    const response = await fetch(
      `${platformApiBase()}/public/blog${qs ? `?${qs}` : ''}`,
      {
        next: { revalidate: 300, tags: ['blog'] },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return EMPTY_BLOG_LIST;
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.data)) {
      return EMPTY_BLOG_LIST;
    }
    const posts = data.data
      .map(normalizePost)
      .filter((post): post is PublicBlogPost => post !== null);
    const meta = isRecord(data.meta) ? data.meta : {};
    const total =
      typeof meta.total === 'number' ? meta.total : posts.length;
    const limit =
      typeof meta.limit === 'number' ? meta.limit : query.limit ?? 20;
    return {
      data: posts,
      meta: {
        page: typeof meta.page === 'number' ? meta.page : query.page ?? 1,
        limit,
        total,
        totalPages:
          typeof meta.totalPages === 'number'
            ? meta.totalPages
            : Math.max(1, Math.ceil(total / Math.max(1, limit))),
      },
    };
  } catch {
    return EMPTY_BLOG_LIST;
  }
}

export async function fetchBlogPost(
  slug: string,
): Promise<PublicBlogPost | null> {
  try {
    const response = await fetch(
      `${platformApiBase()}/public/blog/${encodeURIComponent(slug)}`,
      {
        next: { revalidate: 300, tags: ['blog'] },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return null;
    return normalizePost(await response.json());
  } catch {
    return null;
  }
}

export async function fetchBlogCategories(): Promise<
  PublicBlogCategory[]
> {
  try {
    const response = await fetch(
      `${platformApiBase()}/public/blog/categories`,
      {
        next: { revalidate: 300, tags: ['blog'] },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return [];
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(isRecord)
      .map((row) => ({
        id: asString(row.id) ?? '',
        nameEn: asString(row.nameEn) ?? '',
        nameBn: asString(row.nameBn) ?? '',
        slug: asString(row.slug) ?? '',
        parentId: asString(row.parentId),
        sortOrder:
          typeof row.sortOrder === 'number' ? row.sortOrder : 0,
        postCount:
          typeof row.postCount === 'number' ? row.postCount : 0,
      }))
      .filter((row) => row.slug.length > 0);
  } catch {
    return [];
  }
}

/**
 * YouTube watch / youtu.be / shorts / embed URL → privacy-enhanced
 * embed URL. Anything else (Vimeo, direct mp4, garbage) → null: the
 * detail page renders those as a plain "Watch the video" link.
 */
export function youtubeEmbedUrl(videoUrl: string | null): string | null {
  if (!videoUrl) return null;
  let url: URL;
  try {
    url = new URL(videoUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let id: string | null = null;
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else if (url.pathname.startsWith('/shorts/')) {
      id = url.pathname.split('/')[2] ?? null;
    } else if (url.pathname.startsWith('/embed/')) {
      id = url.pathname.split('/')[2] ?? null;
    }
  } else if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  }
  if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

/** Display date for a post: publish date, else created date. */
export function blogPostDate(post: PublicBlogPost): string | null {
  return post.publishedAt ?? (post.createdAt || null);
}
