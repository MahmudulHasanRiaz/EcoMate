import {
  groupTestimonialRows,
  mapTestimonialPairToReview,
  type TestimonialRow,
} from './testimonial-migration';

function row(
  key: string,
  locale: string,
  value: Record<string, unknown>,
  overrides: Partial<TestimonialRow> = {},
): TestimonialRow {
  return {
    key,
    locale,
    value,
    sortOrder: 0,
    isActive: true,
    status: 'published',
    ...overrides,
  };
}

const EN_VALUE = {
  businessName: 'Aranya Apparel',
  founderName: 'Ayesha Rahman',
  role: 'Founder · Fashion',
  location: 'Dhaka',
  website: 'aranya-apparel.example',
  quote: 'Packing is 3x faster now.',
  category: 'Fashion',
  format: 'text',
  metrics: [{ stat: '3x', label: 'Faster packing' }],
  videoDuration: '02:41',
  videoTitle: 'Customer story',
};

const BN_VALUE = {
  ...EN_VALUE,
  quote: 'প্যাকিং এখন ৩ গুণ দ্রুত।',
  location: 'ঢাকা',
};

describe('groupTestimonialRows', () => {
  it('pairs en/bn rows by key and sorts by key', () => {
    const pairs = groupTestimonialRows([
      row('story-b', 'en', EN_VALUE),
      row('story-a', 'bn', BN_VALUE),
      row('story-a', 'en', EN_VALUE),
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].key).toBe('story-a');
    expect(pairs[0].en).toBeDefined();
    expect(pairs[0].bn).toBeDefined();
    expect(pairs[1].key).toBe('story-b');
    expect(pairs[1].bn).toBeUndefined();
  });
});

describe('mapTestimonialPairToReview', () => {
  const slugs = new Map([['aranya-apparel', 'study-1']]);

  it('maps a full en/bn pair (mapping table §5.2)', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-aranya-apparel',
        en: row('story-aranya-apparel', 'en', {
          ...EN_VALUE,
          imageUrl: 'https://cdn.example.com/ayesha.jpg',
          logoUrl: 'https://cdn.example.com/aranya-logo.png',
          rating: 5,
          caseStudySlug: 'aranya-apparel',
        }),
        bn: row('story-aranya-apparel', 'bn', BN_VALUE),
      },
      slugs,
    );
    expect(result.mapped).toBeDefined();
    expect(result.mapped!.data).toMatchObject({
      reviewerName: 'Ayesha Rahman',
      role: 'Founder · Fashion',
      companyName: 'Aranya Apparel',
      category: 'Fashion',
      location: 'Dhaka',
      quoteEn: 'Packing is 3x faster now.',
      quoteBn: 'প্যাকিং এখন ৩ গুণ দ্রুত।',
      websiteUrl: 'aranya-apparel.example',
      logoUrl: 'https://cdn.example.com/aranya-logo.png',
      rating: 5,
      metrics: [{ stat: '3x', label: 'Faster packing' }],
      format: 'text',
      videoProvider: 'youtube',
      videoDuration: '02:41',
      caseStudyId: 'study-1',
      sortOrder: 0,
      isFeatured: false,
      status: 'published',
      sourceKey: 'testimonials:story-aranya-apparel',
      thumbnailType: 'image',
      thumbnailUrl: 'https://cdn.example.com/ayesha.jpg',
      thumbnailVideoUrl: null,
      videos: [],
      galleryImages: [],
    });
    expect(result.mapped!.warnings).toEqual([]);
  });

  it('maps a video review: the video IS the thumbnail, poster stays', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-video',
        en: row('story-video', 'en', {
          ...EN_VALUE,
          format: 'video_standard',
          videoUrl: 'https://www.youtube.com/watch?v=x',
          videoTitle: 'Aranya story',
          imageUrl: 'https://cdn.example.com/poster.jpg',
        }),
      },
      slugs,
    );
    expect(result.mapped!.data).toMatchObject({
      format: 'video_standard',
      thumbnailType: 'video',
      thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
      thumbnailUrl: 'https://cdn.example.com/poster.jpg',
      videos: [
        { url: 'https://www.youtube.com/watch?v=x', title: 'Aranya story' },
      ],
    });
  });

  it('warns on a poster-less video review instead of failing', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-no-poster',
        en: row('story-no-poster', 'en', {
          ...EN_VALUE,
          format: 'video_short',
          videoUrl: 'https://www.youtube.com/watch?v=x',
        }),
      },
      slugs,
    );
    expect(result.mapped!.data.thumbnailType).toBe('video');
    expect(result.mapped!.data.thumbnailUrl).toBeNull();
    expect(
      result.mapped!.warnings.some((w) => w.includes('no poster image')),
    ).toBe(true);
  });

  it('derives the format from media when the stored format is unknown', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-legacy-format',
        en: row('story-legacy-format', 'en', {
          ...EN_VALUE,
          format: 'legacy-format',
          videoUrl: 'https://www.youtube.com/watch?v=x',
        }),
      },
      slugs,
    );
    expect(result.mapped!.data.format).toBe('video_standard');
    expect(
      result.mapped!.warnings.some((w) => w.includes('unknown format')),
    ).toBe(true);
  });

  it('keeps the video in the gallery even when the format is text', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-text-video',
        en: row('story-text-video', 'en', {
          ...EN_VALUE,
          format: 'text',
          videoUrl: 'https://www.youtube.com/watch?v=x',
        }),
      },
      slugs,
    );
    // Stored format stays 'text'; the public read derives video_standard.
    expect(result.mapped!.data.format).toBe('text');
    expect(result.mapped!.data.thumbnailType).toBe('image');
    expect(result.mapped!.data.videos).toEqual([
      { url: 'https://www.youtube.com/watch?v=x', title: 'Customer story' },
    ]);
  });

  it('migrates an en-only orphan with an empty Bangla quote + warning', () => {
    const result = mapTestimonialPairToReview(
      { key: 'story-en-only', en: row('story-en-only', 'en', EN_VALUE) },
      slugs,
    );
    expect(result.mapped!.data.quoteEn).toBe('Packing is 3x faster now.');
    expect(result.mapped!.data.quoteBn).toBe('');
    expect(result.mapped!.warnings.some((w) => w.includes('orphan'))).toBe(true);
  });

  it('fills quoteEn from the Bangla quote for a bn-only orphan', () => {
    const result = mapTestimonialPairToReview(
      { key: 'story-bn-only', bn: row('story-bn-only', 'bn', BN_VALUE) },
      slugs,
    );
    expect(result.mapped!.data.quoteEn).toBe('প্যাকিং এখন ৩ গুণ দ্রুত।');
    expect(result.mapped!.data.quoteBn).toBe('প্যাকিং এখন ৩ গুণ দ্রুত।');
    expect(result.mapped!.warnings.some((w) => w.includes('orphan'))).toBe(true);
  });

  it('skips a pair with no quote in either locale', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-no-quote',
        en: row('story-no-quote', 'en', { ...EN_VALUE, quote: '  ' }),
        bn: row('story-no-quote', 'bn', { ...BN_VALUE, quote: '' }),
      },
      slugs,
    );
    expect(result.mapped).toBeUndefined();
    expect(result.skipReason).toContain('no quote');
  });

  it('migrates drafts as drafts (status draft OR inactive)', () => {
    const draft = mapTestimonialPairToReview(
      {
        key: 'story-draft',
        en: row('story-draft', 'en', EN_VALUE, { status: 'draft' }),
      },
      slugs,
    );
    expect(draft.mapped!.data.status).toBe('draft');
    const inactive = mapTestimonialPairToReview(
      {
        key: 'story-inactive',
        en: row('story-inactive', 'en', EN_VALUE, { isActive: false }),
      },
      slugs,
    );
    expect(inactive.mapped!.data.status).toBe('draft');
  });

  it('nulls an out-of-range rating with a warning (accepts numeric strings)', () => {
    const bad = mapTestimonialPairToReview(
      {
        key: 'story-bad-rating',
        en: row('story-bad-rating', 'en', { ...EN_VALUE, rating: 9 }),
      },
      slugs,
    );
    expect(bad.mapped!.data.rating).toBeNull();
    expect(bad.mapped!.warnings.some((w) => w.includes('rating'))).toBe(true);
    const stringRating = mapTestimonialPairToReview(
      {
        key: 'story-string-rating',
        en: row('story-string-rating', 'en', { ...EN_VALUE, rating: '4' }),
      },
      slugs,
    );
    expect(stringRating.mapped!.data.rating).toBe(4);
  });

  it('truncates over-long metrics + warns, drops malformed lines', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-metrics',
        en: row('story-metrics', 'en', {
          ...EN_VALUE,
          metrics: [
            ...Array.from({ length: 7 }, (_, i) => ({
              stat: `${i}`,
              label: `Line ${i}`,
            })),
            { stat: '', label: 'Empty stat' },
          ],
        }),
      },
      slugs,
    );
    expect(result.mapped!.data.metrics).toHaveLength(6);
    expect(
      result.mapped!.warnings.some((w) => w.includes('truncated')),
    ).toBe(true);
    expect(
      result.mapped!.warnings.some((w) => w.includes('malformed metric')),
    ).toBe(true);
  });

  it('drops challenge/solution with a warning, keeps the source rows intact', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-challenge',
        en: row('story-challenge', 'en', {
          ...EN_VALUE,
          challenge: 'Packing chaos',
          solution: 'Scan-verify packing',
        }),
      },
      slugs,
    );
    expect(result.mapped).toBeDefined();
    expect(
      result.mapped!.warnings.some((w) => w.includes('challenge/solution')),
    ).toBe(true);
  });

  it('nulls an unresolvable caseStudySlug with a warning (never fatal)', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-ghost-study',
        en: row('story-ghost-study', 'en', {
          ...EN_VALUE,
          caseStudySlug: 'deleted-study',
        }),
      },
      slugs,
    );
    expect(result.mapped!.data.caseStudyId).toBeNull();
    expect(
      result.mapped!.warnings.some((w) => w.includes('does not resolve')),
    ).toBe(true);
  });

  it('tolerates a non-object value (treated as missing fields)', () => {
    const result = mapTestimonialPairToReview(
      {
        key: 'story-bad-value',
        en: row('story-bad-value', 'en', EN_VALUE, { value: 'not-an-object' }),
      },
      slugs,
    );
    expect(result.mapped).toBeUndefined();
    expect(result.skipReason).toContain('no quote');
  });
});
