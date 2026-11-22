import { describe, expect, it } from 'vitest';
import {
  clientReviewFormatLabel,
  isClientReviewFormat,
  reviewQuote,
  type ClientReview,
} from './client-reviews';

function review(overrides: Partial<ClientReview> = {}): ClientReview {
  return {
    id: 'review-1',
    reviewerName: 'Ayesha Rahman',
    role: 'Founder',
    companyName: 'Aranya Apparel',
    category: 'Fashion',
    location: 'Dhaka',
    quoteEn: 'Packing is 3x faster now.',
    quoteBn: 'প্যাকিং এখন ৩ গুণ দ্রুত।',
    websiteUrl: null,
    logoUrl: null,
    rating: 5,
    metrics: [],
    format: 'text',
    effectiveFormat: 'image',
    videoProvider: 'youtube',
    videoDuration: '',
    caseStudyId: null,
    sortOrder: 0,
    isFeatured: false,
    status: 'published',
    sourceKey: null,
    thumbnailType: 'image',
    thumbnailUrl: 'https://cdn.example.com/ayesha.jpg',
    thumbnailVideoUrl: '',
    thumbnailAutoplay: false,
    videos: [],
    galleryImages: [],
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('isClientReviewFormat / clientReviewFormatLabel', () => {
  it('accepts the four formats and labels them', () => {
    expect(isClientReviewFormat('video_short')).toBe(true);
    expect(isClientReviewFormat('video_standard')).toBe(true);
    expect(isClientReviewFormat('image')).toBe(true);
    expect(isClientReviewFormat('text')).toBe(true);
    expect(isClientReviewFormat('carousel')).toBe(false);
    expect(clientReviewFormatLabel('video_short')).toBe(
      'Video (short / vertical)',
    );
    expect(clientReviewFormatLabel('text')).toBe('Text');
  });

  it('passes an unknown format through as its own label', () => {
    expect(clientReviewFormatLabel('carousel')).toBe('carousel');
  });
});

describe('reviewQuote', () => {
  it('returns the Bangla quote in bn, English in en', () => {
    expect(reviewQuote(review(), 'bn')).toBe('প্যাকিং এখন ৩ গুণ দ্রুত।');
    expect(reviewQuote(review(), 'en')).toBe('Packing is 3x faster now.');
  });

  it('falls back to English when the Bangla quote is empty', () => {
    expect(reviewQuote(review({ quoteBn: '   ' }), 'bn')).toBe(
      'Packing is 3x faster now.',
    );
  });
});
