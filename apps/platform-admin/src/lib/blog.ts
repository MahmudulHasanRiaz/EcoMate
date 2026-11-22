import { readJson } from './api';
import type { Page } from '../types';
import type { ContentMediaInput, ContentMediaWire } from './content-media';

/**
 * Blog client helpers (console /blog).
 *
 * Statuses mirror the API (draft | scheduled | published | archived).
 * The API returns both the stored `status` and the computed
 * `effectiveStatus` (a scheduled post whose publish time has arrived
 * counts as published — the on-read publish check). The list shows
 * the effective status with the stored one in parentheses when they
 * differ (e.g. "Published (scheduled)").
 */

export type BlogPostStatus = 'draft' | 'scheduled' | 'published' | 'archived';

export const BLOG_POST_STATUSES: readonly BlogPostStatus[] = [
  'draft',
  'scheduled',
  'published',
  'archived',
];

export const BLOG_STATUS_LABELS: Record<BlogPostStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
};

export interface BlogTag {
  id: string;
  nameEn: string;
  nameBn: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  postCount?: number;
}

export interface BlogCategory {
  id: string;
  nameEn: string;
  nameBn: string;
  descEn: string | null;
  descBn: string | null;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  postCount?: number;
  children?: BlogCategory[];
}

export interface BlogPost extends ContentMediaWire {
  id: string;
  titleEn: string;
  titleBn: string;
  slug: string;
  excerptEn: string | null;
  excerptBn: string | null;
  contentEn: string;
  contentBn: string;
  author: string;
  categoryId: string | null;
  category: Pick<
    BlogCategory,
    'id' | 'nameEn' | 'nameBn' | 'slug'
  > | null;
  /** @deprecated — legacy media columns, derived from the new fields. */
  featuredImageUrl: string | null;
  /** @deprecated — legacy media columns, derived from the new fields. */
  videoUrl: string | null;
  /** @deprecated — legacy media columns, derived from the new fields. */
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
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: BlogTag[];
}

export type BlogPostInput = {
  titleEn: string;
  titleBn: string;
  slug?: string;
  excerptEn?: string;
  excerptBn?: string;
  contentEn: string;
  contentBn?: string;
  author?: string;
  categoryId?: string | null;
  /** @deprecated — send the new media fields instead; the API derives these. */
  featuredImageUrl?: string | null;
  /** @deprecated — send the new media fields instead; the API derives these. */
  videoUrl?: string | null;
  /** @deprecated — send the new media fields instead; the API derives these. */
  galleryUrls?: string[];
  readTime?: number | null;
  status?: string;
  publishedAt?: string | null;
  seoTitleEn?: string | null;
  seoTitleBn?: string | null;
  seoDescEn?: string | null;
  seoDescBn?: string | null;
  canonicalUrl?: string | null;
  tagIds?: string[];
} & ContentMediaInput;

export type BlogCategoryInput = {
  nameEn: string;
  nameBn: string;
  descEn?: string | null;
  descBn?: string | null;
  slug?: string;
  parentId?: string | null;
  sortOrder?: number;
};

export type BlogTagInput = {
  nameEn: string;
  nameBn: string;
  slug?: string;
};

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Lowercase slug from free text (mirrors the API's slugify). */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Display label for a post's status pair (stored + effective). */
export function blogStatusLabel(post: {
  status: string;
  effectiveStatus: string;
}): string {
  const stored =
    BLOG_STATUS_LABELS[post.status as BlogPostStatus] ?? post.status;
  const effective =
    BLOG_STATUS_LABELS[post.effectiveStatus as BlogPostStatus] ??
    post.effectiveStatus;
  return stored === effective ? stored : `${effective} (${stored})`;
}

/** Flatten a category tree into indented options for a <select>. */
export function flattenCategories(
  tree: BlogCategory[],
  depth = 0,
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const node of tree) {
    out.push({
      id: node.id,
      label: `${'— '.repeat(depth)}${node.nameEn}`,
    });
    if (node.children?.length) {
      out.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return out;
}

export function blogQueryString(
  filters: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function fetchBlogPosts(
  api: ApiFetch,
  filters: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    categoryId?: string;
    tagId?: string;
    includeDeleted?: boolean;
  },
): Promise<Page<BlogPost>> {
  return api(
    `/blog${blogQueryString({
      page: filters.page,
      limit: filters.limit,
      status: filters.status,
      search: filters.search,
      categoryId: filters.categoryId,
      tagId: filters.tagId,
      includeDeleted: filters.includeDeleted ? 'true' : undefined,
    })}`,
  ).then((r) => readJson<Page<BlogPost>>(r));
}

export function fetchBlogPost(
  api: ApiFetch,
  id: string,
): Promise<BlogPost> {
  return api(`/blog/${id}`).then((r) => readJson<BlogPost>(r));
}

export function createBlogPost(
  api: ApiFetch,
  input: BlogPostInput,
): Promise<BlogPost> {
  return api('/blog', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => readJson<BlogPost>(r));
}

export function updateBlogPost(
  api: ApiFetch,
  id: string,
  input: Partial<BlogPostInput>,
): Promise<BlogPost> {
  return api(`/blog/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }).then((r) => readJson<BlogPost>(r));
}

export function deleteBlogPost(
  api: ApiFetch,
  id: string,
): Promise<{ deleted: boolean }> {
  return api(`/blog/${id}`, { method: 'DELETE' }).then((r) =>
    readJson<{ deleted: boolean }>(r),
  );
}

export function fetchBlogCategories(
  api: ApiFetch,
): Promise<BlogCategory[]> {
  return api('/blog/categories').then((r) =>
    readJson<BlogCategory[]>(r),
  );
}

export function createBlogCategory(
  api: ApiFetch,
  input: BlogCategoryInput,
): Promise<BlogCategory> {
  return api('/blog/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => readJson<BlogCategory>(r));
}

export function updateBlogCategory(
  api: ApiFetch,
  id: string,
  input: Partial<BlogCategoryInput>,
): Promise<BlogCategory> {
  return api(`/blog/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }).then((r) => readJson<BlogCategory>(r));
}

export function deleteBlogCategory(
  api: ApiFetch,
  id: string,
): Promise<{ deleted: boolean }> {
  return api(`/blog/categories/${id}`, { method: 'DELETE' }).then((r) =>
    readJson<{ deleted: boolean }>(r),
  );
}

export function fetchBlogTags(api: ApiFetch): Promise<BlogTag[]> {
  return api('/blog/tags').then((r) => readJson<BlogTag[]>(r));
}

export function createBlogTag(
  api: ApiFetch,
  input: BlogTagInput,
): Promise<BlogTag> {
  return api('/blog/tags', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => readJson<BlogTag>(r));
}

export function updateBlogTag(
  api: ApiFetch,
  id: string,
  input: Partial<BlogTagInput>,
): Promise<BlogTag> {
  return api(`/blog/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }).then((r) => readJson<BlogTag>(r));
}

export function deleteBlogTag(
  api: ApiFetch,
  id: string,
): Promise<{ deleted: boolean }> {
  return api(`/blog/tags/${id}`, { method: 'DELETE' }).then((r) =>
    readJson<{ deleted: boolean }>(r),
  );
}
