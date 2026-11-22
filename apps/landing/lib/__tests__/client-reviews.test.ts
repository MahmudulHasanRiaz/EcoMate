import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPublicClientReviews,
  isPublicClientReview,
  normalizePublicClientReview,
  reviewQuote,
  type PublicClientReview,
} from '../client-reviews';

function review(overrides: Partial<PublicClientReview> = {}): PublicClientReview {
  return {
    id: 'review-1',
    reviewerName: 'Ayesha Rahman',
    role: 'Founder',
    companyName: 'Aranya Apparel',
    category: 'Fashion',
    location: 'Dhaka',
    quoteEn: 'EcoMate changed how we pack orders.',
    quoteBn: '',
    websiteUrl: null,
    logoUrl: null,
    rating: 5,
    metrics: [{ stat: '3x', label: 'Faster packing' }],
    format: 'text',
    effectiveFormat: 'text',
    videoProvider: 'youtube',
    videoDuration: '',
    caseStudyId: null,
    sortOrder: 0,
    isFeatured: false,
    status: 'published',
    thumbnailType: 'image',
    thumbnailUrl: null,
    thumbnailVideoUrl: null,
    thumbnailAutoplay: false,
    videos: [],
    galleryImages: [],
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('isPublicClientReview', () => {
  it('accepts a well-formed review', () => {
    expect(isPublicClientReview(review())).toBe(true);
  });

  it('accepts a review whose media fields are missing (older API)', () => {
    const row = review();
    delete (row as Partial<PublicClientReview>).thumbnailType;
    delete (row as Partial<PublicClientReview>).thumbnailUrl;
    delete (row as Partial<PublicClientReview>).thumbnailVideoUrl;
    delete (row as Partial<PublicClientReview>).thumbnailAutoplay;
    delete (row as Partial<PublicClientReview>).videos;
    delete (row as Partial<PublicClientReview>).galleryImages;
    expect(isPublicClientReview(row)).toBe(true);
  });

  it('rejects a review missing its quote, name or company', () => {
    expect(isPublicClientReview(review({ quoteEn: '' }))).toBe(false);
    expect(isPublicClientReview(review({ quoteEn: '  ' }))).toBe(false);
    expect(isPublicClientReview(review({ reviewerName: '' }))).toBe(false);
    expect(isPublicClientReview(review({ companyName: '' }))).toBe(false);
  });

  it('rejects a bad format or rating', () => {
    expect(
      isPublicClientReview(review({ format: 'cinematic' as never })),
    ).toBe(false);
    expect(isPublicClientReview(review({ rating: 0 }))).toBe(false);
    expect(isPublicClientReview(review({ rating: 7 }))).toBe(false);
    expect(isPublicClientReview(review({ rating: 4.5 }))).toBe(false);
    expect(isPublicClientReview(review({ rating: null }))).toBe(true);
  });

  it('rejects malformed metrics or galleries', () => {
    expect(
      isPublicClientReview(review({ metrics: [{ stat: '3x' } as never] })),
    ).toBe(false);
    expect(
      isPublicClientReview(review({ videos: [{ url: '' }] })),
    ).toBe(false);
    expect(
      isPublicClientReview(review({ videos: 'not-an-array' as never })),
    ).toBe(false);
    // Plain-string gallery entries are tolerated (§2.2).
    expect(
      isPublicClientReview(
        review({ videos: ['https://youtu.be/dQw4w9WgXcQ'] as never }),
      ),
    ).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isPublicClientReview(null)).toBe(false);
    expect(isPublicClientReview('nope')).toBe(false);
    expect(isPublicClientReview([])).toBe(false);
  });
});

describe('normalizePublicClientReview', () => {
  it("trusts the API's effectiveFormat when present (§3.1)", () => {
    // The API derives effectiveFormat at read time from the current
    // media, so its value is authoritative — even when it disagrees
    // with what the local derivation would say.
    expect(
      normalizePublicClientReview(
        review({
          format: 'video_standard',
          thumbnailType: 'video',
          thumbnailVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
          effectiveFormat: 'video_standard',
        }),
      ).effectiveFormat,
    ).toBe('video_standard');
    expect(
      normalizePublicClientReview(
        review({
          format: 'video_standard',
          thumbnailType: 'video',
          thumbnailVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
          effectiveFormat: 'text',
        }),
      ).effectiveFormat,
    ).toBe('text');
  });

  it('falls back to the local derivation when the API omits effectiveFormat', () => {
    const withoutEffective = (
      overrides: Partial<PublicClientReview>,
    ): PublicClientReview => {
      const row = review(overrides);
      delete (row as Partial<PublicClientReview>).effectiveFormat;
      return row;
    };
    expect(
      normalizePublicClientReview(
        withoutEffective({
          format: 'video_standard',
          thumbnailType: 'video',
          thumbnailVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        }),
      ).effectiveFormat,
    ).toBe('video_standard');
    // Gallery-images-only falls back to 'image' (§3.1 hasImage).
    expect(
      normalizePublicClientReview(
        withoutEffective({
          format: 'text',
          galleryImages: [{ url: 'https://cdn.example.com/g.jpg' }],
        }),
      ).effectiveFormat,
    ).toBe('image');
    // An invalid API value also falls back to the derivation.
    expect(
      normalizePublicClientReview(
        review({
          format: 'video_standard',
          thumbnailType: 'video',
          thumbnailVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
          effectiveFormat: 'cinematic' as never,
        }),
      ).effectiveFormat,
    ).toBe('video_standard');
  });

  it('downgrades a video claim with no video to image, then text', () => {
    // No effectiveFormat from the API: the fallback derivation runs.
    const withoutEffective = (
      overrides: Partial<PublicClientReview>,
    ): PublicClientReview => {
      const row = review(overrides);
      delete (row as Partial<PublicClientReview>).effectiveFormat;
      return row;
    };
    expect(
      normalizePublicClientReview(
        withoutEffective({
          format: 'video_standard',
          thumbnailUrl: 'https://cdn.example.com/p.jpg',
        }),
      ).effectiveFormat,
    ).toBe('image');
    expect(
      normalizePublicClientReview(
        withoutEffective({ format: 'video_short' }),
      ).effectiveFormat,
    ).toBe('text');
  });
});

describe('reviewQuote', () => {
  it('falls back to English when the Bangla quote is empty', () => {
    expect(reviewQuote(review(), 'bn')).toBe(
      'EcoMate changed how we pack orders.',
    );
    expect(
      reviewQuote(review({ quoteBn: 'বাংলা উদ্ধৃতি' }), 'bn'),
    ).toBe('বাংলা উদ্ধৃতি');
    expect(reviewQuote(review({ quoteBn: 'বাংলা উদ্ধৃতি' }), 'en')).toBe(
      'EcoMate changed how we pack orders.',
    );
  });
});

describe('fetchPublicClientReviews', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns normalized reviews and drops malformed rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          review(),
          { id: 'broken' },
          review({
            id: 'review-2',
            format: 'video_standard',
            // The real API sends effectiveFormat on every row.
            effectiveFormat: 'video_standard',
            thumbnailType: 'video',
            thumbnailVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
          }),
        ],
      })),
    );
    const reviews = await fetchPublicClientReviews();
    expect(reviews).toHaveLength(2);
    expect(reviews[0].effectiveFormat).toBe('text');
    expect(reviews[1].effectiveFormat).toBe('video_standard');
  });

  it('returns [] on a non-OK response, a non-array body, or a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => [] })),
    );
    expect(await fetchPublicClientReviews()).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    expect(await fetchPublicClientReviews()).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down');
    }));
    expect(await fetchPublicClientReviews()).toEqual([]);
  });
});
