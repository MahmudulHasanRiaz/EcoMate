import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blogPostDate,
  fetchBlogPost,
  fetchBlogPosts,
  sanitizeBlogHtml,
  youtubeEmbedUrl,
} from '../blog';

describe('sanitizeBlogHtml', () => {
  it('keeps Tiptap formatting but strips scripts, handlers and iframes', () => {
    const out = sanitizeBlogHtml(
      '<h2>Title</h2><p onclick="evil()">Hi <strong>there</strong></p>' +
        '<script>alert(1)</script>' +
        '<iframe src="https://evil.example.com"></iframe>' +
        '<a href="https://example.com" target="_blank">link</a>' +
        '<img src="https://example.com/x.png" onerror="evil()">',
    );
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>there</strong>');
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onerror');
  });

  it('strips javascript: URLs', () => {
    const out = sanitizeBlogHtml(
      '<a href="javascript:alert(1)">click</a>',
    );
    expect(out).not.toContain('javascript:');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeBlogHtml('')).toBe('');
  });
});

describe('youtubeEmbedUrl', () => {
  it('converts watch / youtu.be / shorts / embed URLs', () => {
    expect(
      youtubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(
      youtubeEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    ).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(
      youtubeEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'),
    ).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URLs and garbage', () => {
    expect(youtubeEmbedUrl('https://vimeo.com/123456')).toBeNull();
    expect(youtubeEmbedUrl('https://example.com/video.mp4')).toBeNull();
    expect(youtubeEmbedUrl('not a url')).toBeNull();
    expect(youtubeEmbedUrl(null)).toBeNull();
    expect(youtubeEmbedUrl('https://www.youtube.com/watch')).toBeNull();
  });
});

describe('blogPostDate', () => {
  it('prefers publishedAt, falls back to createdAt', () => {
    expect(
      blogPostDate({
        publishedAt: '2026-11-19T00:00:00.000Z',
        createdAt: '2026-11-18T00:00:00.000Z',
      } as any),
    ).toBe('2026-11-19T00:00:00.000Z');
    expect(
      blogPostDate({
        publishedAt: null,
        createdAt: '2026-11-18T00:00:00.000Z',
      } as any),
    ).toBe('2026-11-18T00:00:00.000Z');
  });
});

describe('blog fetches fail soft', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchBlogPosts returns the empty list when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const page = await fetchBlogPosts({ limit: 5 });
    expect(page.data).toEqual([]);
    expect(page.meta.total).toBe(0);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    await expect(fetchBlogPosts()).resolves.toEqual(
      expect.objectContaining({ data: [] }),
    );
  });

  it('fetchBlogPost returns null when the API is down or 404s', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(fetchBlogPost('missing-slug')).resolves.toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    await expect(fetchBlogPost('missing-slug')).resolves.toBeNull();
  });

  it('fetchBlogPosts normalizes rows and sanitizes content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'post-1',
              titleEn: 'Hello',
              titleBn: 'হ্যালো',
              slug: 'hello',
              excerptEn: 'Intro',
              excerptBn: null,
              contentEn:
                '<p>Hi</p><script>alert(1)</script>',
              contentBn: '',
              author: 'EcoMate',
              category: {
                id: 'cat-1',
                nameEn: 'Guides',
                nameBn: 'গাইড',
                slug: 'guides',
              },
              featuredImageUrl: null,
              videoUrl: null,
              galleryUrls: ['a.png', 42],
              readTime: 2,
              status: 'published',
              effectiveStatus: 'published',
              publishedAt: '2026-11-19T00:00:00.000Z',
              seoTitleEn: null,
              seoTitleBn: null,
              seoDescEn: null,
              seoDescBn: null,
              canonicalUrl: null,
              tags: [{ id: 't1', nameEn: 'POS', nameBn: 'পস', slug: 'pos' }],
              createdAt: '2026-11-19T00:00:00.000Z',
              updatedAt: '2026-11-19T00:00:00.000Z',
            },
            { garbage: true },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        }),
      }),
    );
    const page = await fetchBlogPosts();
    expect(page.data).toHaveLength(1);
    expect(page.data[0].slug).toBe('hello');
    expect(page.data[0].contentEn).toBe('<p>Hi</p>');
    expect(page.data[0].galleryUrls).toEqual(['a.png']);
    expect(page.data[0].tags).toEqual([
      { id: 't1', nameEn: 'POS', nameBn: 'পস', slug: 'pos' },
    ]);
  });
});
