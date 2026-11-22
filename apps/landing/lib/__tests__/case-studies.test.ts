import { afterEach, describe, expect, it, vi } from 'vitest';
import { landingContent } from '../../data/landingContent';
import {
  fetchPublicCaseStudies,
  fetchPublicCaseStudy,
  isCaseStudySlug,
  isPublicCaseStudy,
  type PublicCaseStudy,
} from '../case-studies';
import {
  mergeLandingContent,
  type ManagedLocaleContent,
} from '../landing-content';

function study(overrides: Partial<PublicCaseStudy> = {}): PublicCaseStudy {
  return {
    id: 'study-1',
    title: 'Dhaka Fashion House',
    slug: 'dhaka-fashion-house',
    client: 'Dhaka Fashion House',
    businessType: 'Fashion retail',
    problem: 'Orders in spreadsheets.',
    solution: 'Moved to EcoMate.',
    outcome: '3x faster packing.',
    metrics: [{ stat: '3x', label: 'Faster packing' }],
    featuredImageUrl: null,
    videoUrl: null,
    websiteUrl: null,
    seoTitle: null,
    seoDescription: null,
    isPublished: true,
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('isCaseStudySlug', () => {
  it('accepts lowercase hyphenated slugs', () => {
    expect(isCaseStudySlug('dhaka-fashion-house')).toBe(true);
    expect(isCaseStudySlug('a1-b2')).toBe(true);
  });

  it('rejects uppercase, spaces, underscores, and edge hyphens', () => {
    expect(isCaseStudySlug('Dhaka-Fashion')).toBe(false);
    expect(isCaseStudySlug('dhaka fashion')).toBe(false);
    expect(isCaseStudySlug('dhaka_fashion')).toBe(false);
    expect(isCaseStudySlug('-dhaka-')).toBe(false);
    expect(isCaseStudySlug('')).toBe(false);
    expect(isCaseStudySlug(undefined)).toBe(false);
    expect(isCaseStudySlug(42)).toBe(false);
  });
});

describe('isPublicCaseStudy', () => {
  it('accepts a well-formed study', () => {
    expect(isPublicCaseStudy(study())).toBe(true);
  });

  it('rejects a study with a bad slug', () => {
    expect(isPublicCaseStudy(study({ slug: 'Bad Slug' }))).toBe(false);
  });

  it('rejects a study missing required text', () => {
    expect(isPublicCaseStudy(study({ outcome: '' }))).toBe(false);
    expect(isPublicCaseStudy(study({ problem: '   ' }))).toBe(false);
  });

  it('rejects a study with malformed metrics', () => {
    expect(
      isPublicCaseStudy(study({ metrics: [{ stat: '3x', label: '' }] })),
    ).toBe(false);
    expect(
      isPublicCaseStudy(study({ metrics: '3x faster' as any })),
    ).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isPublicCaseStudy(null)).toBe(false);
    expect(isPublicCaseStudy('study')).toBe(false);
    expect(isPublicCaseStudy([])).toBe(false);
  });

  it('accepts a study with the new media fields (§4.5)', () => {
    expect(
      isPublicCaseStudy(
        study({
          thumbnailType: 'video',
          thumbnailUrl: 'https://cdn.example.com/poster.jpg',
          thumbnailVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
          thumbnailAutoplay: true,
          videos: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Demo' }],
          galleryImages: [
            { url: 'https://cdn.example.com/g.jpg', alt: 'Packing' },
            'https://cdn.example.com/plain.jpg',
          ],
        }),
      ),
    ).toBe(true);
  });

  it('accepts a study WITHOUT the new media fields (older API, §4.5)', () => {
    // The factory builds a row with no media fields at all.
    expect(isPublicCaseStudy(study())).toBe(true);
  });

  it('rejects a study with malformed media fields', () => {
    expect(
      isPublicCaseStudy(study({ thumbnailType: 'sideways' as any })),
    ).toBe(false);
    expect(
      isPublicCaseStudy(study({ videos: [{ url: '' }] })),
    ).toBe(false);
    expect(
      isPublicCaseStudy(study({ galleryImages: 'nope' as any })),
    ).toBe(false);
  });
});

describe('fetchPublicCaseStudies', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns the published list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [study()],
      }),
    );
    await expect(fetchPublicCaseStudies()).resolves.toEqual([study()]);
  });

  it('returns [] when the API is down or returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(fetchPublicCaseStudies()).resolves.toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    await expect(fetchPublicCaseStudies()).resolves.toEqual([]);
  });

  it('drops malformed rows instead of crashing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [study(), study({ slug: 'Bad Slug' }), null],
      }),
    );
    await expect(fetchPublicCaseStudies()).resolves.toEqual([study()]);
  });

  it('returns [] for a non-array payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ studies: [study()] }),
      }),
    );
    await expect(fetchPublicCaseStudies()).resolves.toEqual([]);
  });
});

describe('fetchPublicCaseStudy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns the study on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => study(),
      }),
    );
    await expect(fetchPublicCaseStudy('dhaka-fashion-house')).resolves.toEqual(
      study(),
    );
  });

  it('returns null on 404 without fetching a bad slug', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Case study not found' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPublicCaseStudy('no-such-study')).resolves.toBeNull();
    await expect(fetchPublicCaseStudy('Bad Slug')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(fetchPublicCaseStudy('dhaka-fashion-house')).resolves.toBeNull();
  });

  it('returns null for a malformed payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => study({ title: '' }),
      }),
    );
    await expect(fetchPublicCaseStudy('dhaka-fashion-house')).resolves.toBeNull();
  });
});

describe('testimonial → case-study link (merge)', () => {
  const FALLBACK = landingContent.en;

  function testimonial(overrides: Record<string, unknown> = {}) {
    return {
      key: 't1',
      businessName: 'Dhaka Fashion House',
      founderName: 'Ayesha Khan',
      role: 'Founder',
      location: 'Dhaka',
      website: 'dhakafashion.example',
      quote: 'EcoMate changed everything.',
      videoDuration: '2:30',
      videoTitle: 'Customer story',
      metrics: [{ stat: '3x', label: 'Faster packing' }],
      ...overrides,
    };
  }

  it('carries a well-formed caseStudySlug onto the merged study', () => {
    const managed: ManagedLocaleContent = {
      testimonials: [testimonial({ caseStudySlug: 'dhaka-fashion-house' })],
    };
    const merged = mergeLandingContent(FALLBACK, managed);
    expect(merged.proof.caseStudies).toHaveLength(1);
    expect(merged.proof.caseStudies[0].caseStudySlug).toBe(
      'dhaka-fashion-house',
    );
  });

  it('drops a malformed caseStudySlug (no bad link)', () => {
    const managed: ManagedLocaleContent = {
      testimonials: [testimonial({ caseStudySlug: 'Bad Slug!' })],
    };
    const merged = mergeLandingContent(FALLBACK, managed);
    expect(merged.proof.caseStudies[0].caseStudySlug).toBeUndefined();
  });

  it('leaves the slug undefined when the testimonial has none', () => {
    const managed: ManagedLocaleContent = {
      testimonials: [testimonial()],
    };
    const merged = mergeLandingContent(FALLBACK, managed);
    expect(merged.proof.caseStudies[0].caseStudySlug).toBeUndefined();
  });
});
