/**
 * Blog constants (Landing CMS Batch 2, item 20).
 *
 * Status is a String validated at the API layer — intentionally NOT a
 * Prisma enum (same rule as the landing sections): a new status needs
 * no migration. The four statuses:
 * - draft: never public.
 * - scheduled: public once publishedAt <= now (on-read publish check,
 *   no cron — see BlogService.effectiveStatus).
 * - published: public.
 * - archived: was public, now hidden again.
 */
export const BLOG_POST_STATUSES = [
  'draft',
  'scheduled',
  'published',
  'archived',
] as const;

export type BlogPostStatus = (typeof BLOG_POST_STATUSES)[number];

/** Slugs: lowercase letters, digits, single hyphens, no leading/trailing hyphen. */
export const BLOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Words-per-minute used to auto-compute readTime when omitted. */
export const BLOG_READ_WORDS_PER_MINUTE = 200;

import { MEDIA_MAX_GALLERY_IMAGES } from '../common/media/media.constants';

/**
 * Max gallery images per post (keeps the landing gallery grid sane).
 * @deprecated Alias of MEDIA_MAX_GALLERY_IMAGES — kept so no existing
 * import breaks; new code imports the shared constant directly.
 */
export const BLOG_MAX_GALLERY_URLS = MEDIA_MAX_GALLERY_IMAGES;

/**
 * Effective status of a post at a moment in time: a scheduled post
 * whose publish time has arrived counts as published. The stored
 * status never changes on read — the admin list shows both the stored
 * status and this computed one.
 */
export function effectiveStatus(
  post: { status: string; publishedAt: Date | string | null },
  now: Date = new Date(),
): string {
  if (post.status !== 'scheduled') return post.status;
  if (!post.publishedAt) return 'scheduled';
  const at = post.publishedAt instanceof Date ? post.publishedAt : new Date(post.publishedAt);
  return at <= now ? 'published' : 'scheduled';
}

/** A post is publicly visible iff it is live and effectively published. */
export function isPubliclyVisible(
  post: {
    status: string;
    publishedAt: Date | string | null;
    deletedAt: Date | string | null;
  },
  now: Date = new Date(),
): boolean {
  if (post.deletedAt) return false;
  return effectiveStatus(post, now) === 'published';
}

/** Lowercase slug from free text (title/name → slug). Empty input → ''. */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Strip HTML tags (Tiptap content) down to plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read time in whole minutes from HTML content (min 1 when non-empty). */
export function readTimeFromContent(html: string): number | null {
  const text = stripHtml(html);
  if (!text) return null;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / BLOG_READ_WORDS_PER_MINUTE));
}
