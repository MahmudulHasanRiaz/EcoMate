import { validate } from 'class-validator';
import {
  isMediaUrl,
  isPlayableVideoUrl,
  type ContentMediaFields,
} from './media.constants';
import { MediaFieldsDto, normalizeMediaFields } from './media.dto';
import {
  deriveLegacyMedia,
  normalizeGalleryLenient,
  resolveMediaWithLegacyFallback,
  resolveMediaWrite,
} from './media.service-helpers';

function prevMedia(overrides: Partial<ContentMediaFields> = {}): ContentMediaFields {
  return {
    thumbnailType: 'image',
    thumbnailUrl: null,
    thumbnailVideoUrl: null,
    thumbnailAutoplay: false,
    videos: [],
    galleryImages: [],
    ...overrides,
  };
}

describe('isMediaUrl', () => {
  it('accepts https and relative paths', () => {
    expect(isMediaUrl('https://cdn.example.com/a.jpg')).toBe(true);
    expect(isMediaUrl('/api/public/media/abc')).toBe(true);
    expect(isMediaUrl('/media/x.png')).toBe(true);
  });

  it('rejects http, protocol-relative, data, javascript and bare words', () => {
    expect(isMediaUrl('http://cdn.example.com/a.jpg')).toBe(false);
    expect(isMediaUrl('//cdn.example.com/a.jpg')).toBe(false);
    expect(isMediaUrl('data:image/png;base64,xxx')).toBe(false);
    expect(isMediaUrl('javascript:alert(1)')).toBe(false);
    expect(isMediaUrl('not-a-url')).toBe(false);
    expect(isMediaUrl('')).toBe(false);
    expect(isMediaUrl('/')).toBe(false);
    expect(isMediaUrl(null)).toBe(false);
    expect(isMediaUrl(42)).toBe(false);
  });

  it('rejects URLs with whitespace or over the length cap', () => {
    expect(isMediaUrl('https://example.com/a b.jpg')).toBe(false);
    expect(isMediaUrl(`https://example.com/${'a'.repeat(2048)}`)).toBe(false);
  });
});

describe('isPlayableVideoUrl', () => {
  it('accepts YouTube, Vimeo, direct files and media-library URLs', () => {
    expect(isPlayableVideoUrl('https://www.youtube.com/watch?v=x')).toBe(true);
    expect(isPlayableVideoUrl('https://youtu.be/x')).toBe(true);
    expect(isPlayableVideoUrl('https://vimeo.com/123456')).toBe(true);
    expect(isPlayableVideoUrl('https://cdn.example.com/v.mp4')).toBe(true);
    expect(isPlayableVideoUrl('https://cdn.example.com/v.webm?t=1')).toBe(true);
    expect(isPlayableVideoUrl('/api/public/media/abc')).toBe(true);
    expect(
      isPlayableVideoUrl('https://api.example.com/api/public/media/abc'),
    ).toBe(true);
  });

  it('rejects images, documents and unknown hosts', () => {
    expect(isPlayableVideoUrl('https://cdn.example.com/a.jpg')).toBe(false);
    expect(isPlayableVideoUrl('https://cdn.example.com/v.mov')).toBe(false);
    expect(isPlayableVideoUrl('https://example.com/watch?v=x')).toBe(false);
    expect(isPlayableVideoUrl('/media/clip.avi')).toBe(false);
  });
});

describe('MediaFieldsDto validation (shape layer)', () => {
  function dto(patch: Partial<MediaFieldsDto>): MediaFieldsDto {
    return Object.assign(new MediaFieldsDto(), patch);
  }

  it('accepts an empty fragment', async () => {
    await expect(validate(dto({}))).resolves.toEqual([]);
  });

  it('accepts a full valid fragment (object + plain-string entries)', async () => {
    await expect(
      validate(
        dto({
          thumbnailType: 'video',
          thumbnailUrl: 'https://cdn.example.com/poster.jpg',
          thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
          thumbnailAutoplay: true,
          videos: [
            { url: 'https://www.youtube.com/watch?v=x', title: 'Intro' },
            'https://cdn.example.com/clip.mp4',
          ],
          galleryImages: [
            { url: '/api/public/media/a', alt: 'Front', caption: 'Shop' },
          ],
        }),
      ),
    ).resolves.toEqual([]);
  });

  it('rejects an unknown thumbnailType', async () => {
    const errors = await validate(dto({ thumbnailType: 'audio' }));
    expect(errors.some((e) => e.property === 'thumbnailType')).toBe(true);
  });

  it('rejects an empty thumbnailUrl', async () => {
    const errors = await validate(dto({ thumbnailUrl: '  ' }));
    expect(errors.some((e) => e.property === 'thumbnailUrl')).toBe(true);
  });

  it('rejects more than 20 gallery images / 10 videos', async () => {
    const images = Array.from({ length: 21 }, (_, i) => ({
      url: `https://cdn.example.com/${i}.jpg`,
    }));
    const errors = await validate(dto({ galleryImages: images }));
    expect(errors.some((e) => e.property === 'galleryImages')).toBe(true);
    const clips = Array.from({ length: 11 }, (_, i) => ({
      url: `https://cdn.example.com/${i}.mp4`,
    }));
    const errors2 = await validate(dto({ videos: clips }));
    expect(errors2.some((e) => e.property === 'videos')).toBe(true);
  });

  it('rejects a gallery entry without a url and a bad duration', async () => {
    const errors = await validate(
      dto({ galleryImages: [{ url: '' } as any] }),
    );
    expect(errors.some((e) => e.property === 'galleryImages')).toBe(true);
    const errors2 = await validate(
      dto({ videos: [{ url: 'https://cdn.example.com/v.mp4', duration: '2:5' }] }),
    );
    expect(errors2.some((e) => e.property === 'videos')).toBe(true);
  });

  it('rejects an over-long alt / caption / title', async () => {
    const errors = await validate(
      dto({ galleryImages: [{ url: 'https://cdn.example.com/a.jpg', alt: 'x'.repeat(201) }] }),
    );
    expect(errors.some((e) => e.property === 'galleryImages')).toBe(true);
  });
});

describe('normalizeMediaFields', () => {
  it('defaults a create with no media', () => {
    expect(normalizeMediaFields({})).toEqual({
      thumbnailType: 'image',
      thumbnailUrl: null,
      thumbnailVideoUrl: null,
      thumbnailAutoplay: false,
      videos: [],
      galleryImages: [],
    });
  });

  it('normalizes plain-string entries to objects and strips unknown keys', () => {
    const out = normalizeMediaFields({
      videos: ['https://www.youtube.com/watch?v=x'],
      galleryImages: [
        { url: 'https://cdn.example.com/a.jpg', alt: 'A', extra: 1 } as any,
      ],
    });
    expect(out.videos).toEqual([{ url: 'https://www.youtube.com/watch?v=x' }]);
    expect(out.galleryImages).toEqual([
      { url: 'https://cdn.example.com/a.jpg', alt: 'A' },
    ]);
  });

  it('dedupes galleries by url, keeping the first occurrence', () => {
    const out = normalizeMediaFields({
      galleryImages: [
        { url: 'https://cdn.example.com/a.jpg', alt: 'First' },
        { url: 'https://cdn.example.com/a.jpg', alt: 'Second' },
        'https://cdn.example.com/a.jpg',
      ],
    });
    expect(out.galleryImages).toEqual([
      { url: 'https://cdn.example.com/a.jpg', alt: 'First' },
    ]);
  });

  it('requires a poster + video URL for a video thumbnail', () => {
    expect(() =>
      normalizeMediaFields({ thumbnailType: 'video' }),
    ).toThrow('thumbnailVideoUrl is required');
    expect(() =>
      normalizeMediaFields({
        thumbnailType: 'video',
        thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
      }),
    ).toThrow('thumbnailUrl (the poster) is required');
  });

  it('accepts a video thumbnail with poster + playable video', () => {
    const out = normalizeMediaFields({
      thumbnailType: 'video',
      thumbnailUrl: 'https://cdn.example.com/poster.jpg',
      thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
      thumbnailAutoplay: true,
    });
    expect(out.thumbnailType).toBe('video');
    expect(out.thumbnailAutoplay).toBe(true);
  });

  it('rejects a non-playable thumbnail video URL', () => {
    expect(() =>
      normalizeMediaFields({
        thumbnailType: 'video',
        thumbnailUrl: 'https://cdn.example.com/poster.jpg',
        thumbnailVideoUrl: 'https://cdn.example.com/photo.jpg',
      }),
    ).toThrow('must be a YouTube/Vimeo URL');
  });

  it('rejects an http thumbnail URL for a NEW entry', () => {
    expect(() =>
      normalizeMediaFields({ thumbnailUrl: 'http://cdn.example.com/a.jpg' }),
    ).toThrow('must be an https:// URL');
  });

  it('grandfathers an unchanged http thumbnail URL from the previous row', () => {
    const out = normalizeMediaFields(
      { galleryImages: [{ url: 'https://cdn.example.com/b.jpg' }] },
      prevMedia({ thumbnailUrl: 'http://cdn.example.com/a.jpg' }),
    );
    expect(out.thumbnailUrl).toBe('http://cdn.example.com/a.jpg');
  });

  it('rejects an http video URL for a NEW gallery entry', () => {
    expect(() =>
      normalizeMediaFields({ videos: ['http://cdn.example.com/v.mp4'] }),
    ).toThrow('must be an https:// URL');
  });

  it('grandfathers an unchanged legacy video URL in the gallery', () => {
    const out = normalizeMediaFields(
      { thumbnailUrl: 'https://cdn.example.com/poster.jpg' },
      prevMedia({
        videos: [{ url: 'http://legacy.example.com/clip.avi' }],
      }),
    );
    expect(out.videos).toEqual([{ url: 'http://legacy.example.com/clip.avi' }]);
  });

  it('rejects an unknown thumbnailType', () => {
    expect(() => normalizeMediaFields({ thumbnailType: 'audio' })).toThrow(
      `thumbnailType must be 'image' or 'video'`,
    );
  });

  it('rejects over-cap galleries on write', () => {
    const clips = Array.from({ length: 11 }, (_, i) => ({
      url: `https://cdn.example.com/${i}.mp4`,
    }));
    expect(() => normalizeMediaFields({ videos: clips })).toThrow(
      'videos holds at most 10 entries',
    );
  });

  it('clears the video URL + autoplay when switching video → image', () => {
    const out = normalizeMediaFields(
      { thumbnailType: 'image' },
      prevMedia({
        thumbnailType: 'video',
        thumbnailUrl: 'https://cdn.example.com/poster.jpg',
        thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
        thumbnailAutoplay: true,
      }),
    );
    expect(out.thumbnailType).toBe('image');
    expect(out.thumbnailVideoUrl).toBeNull();
    expect(out.thumbnailAutoplay).toBe(false);
    // The video survives in the gallery (§6.3 rule 8).
    expect(out.videos).toEqual([{ url: 'https://www.youtube.com/watch?v=x' }]);
    expect(out.thumbnailUrl).toBe('https://cdn.example.com/poster.jpg');
  });

  it('does not duplicate the rescued video when it is already in the gallery', () => {
    const out = normalizeMediaFields(
      { thumbnailType: 'image' },
      prevMedia({
        thumbnailType: 'video',
        thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
        videos: [{ url: 'https://www.youtube.com/watch?v=x' }],
      }),
    );
    expect(out.videos).toEqual([{ url: 'https://www.youtube.com/watch?v=x' }]);
  });

  it('allows cap+1 for the rescued video when the gallery is already full', () => {
    const full = Array.from({ length: 10 }, (_, i) => ({
      url: `https://cdn.example.com/${i}.mp4`,
    }));
    const out = normalizeMediaFields(
      { thumbnailType: 'image' },
      prevMedia({
        thumbnailType: 'video',
        thumbnailVideoUrl: 'https://www.youtube.com/watch?v=rescued',
        videos: full,
      }),
    );
    expect(out.videos).toHaveLength(11);
    expect(out.videos[0]).toEqual({
      url: 'https://www.youtube.com/watch?v=rescued',
    });
  });

  it('keeps the poster when switching image → video', () => {
    const out = normalizeMediaFields(
      {
        thumbnailType: 'video',
        thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
      },
      prevMedia({ thumbnailUrl: 'https://cdn.example.com/poster.jpg' }),
    );
    expect(out.thumbnailUrl).toBe('https://cdn.example.com/poster.jpg');
    expect(out.thumbnailVideoUrl).toBe('https://www.youtube.com/watch?v=x');
  });

  it('treats an empty-string thumbnail as a clear', () => {
    const out = normalizeMediaFields(
      { thumbnailUrl: '   ' },
      prevMedia({ thumbnailUrl: 'https://cdn.example.com/a.jpg' }),
    );
    expect(out.thumbnailUrl).toBeNull();
  });
});

describe('deriveLegacyMedia', () => {
  it('derives the three legacy columns from the new fields', () => {
    expect(
      deriveLegacyMedia({
        thumbnailType: 'video',
        thumbnailUrl: 'https://cdn.example.com/poster.jpg',
        thumbnailVideoUrl: 'https://www.youtube.com/watch?v=t',
        thumbnailAutoplay: true,
        videos: [{ url: 'https://cdn.example.com/first.mp4' }],
        galleryImages: [
          { url: 'https://cdn.example.com/a.jpg' },
          { url: 'https://cdn.example.com/b.jpg' },
        ],
      }),
    ).toEqual({
      featuredImageUrl: 'https://cdn.example.com/poster.jpg',
      videoUrl: 'https://cdn.example.com/first.mp4',
      galleryUrls: [
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
      ],
    });
  });

  it('falls back to the thumbnail video when the gallery is empty', () => {
    const legacy = deriveLegacyMedia(
      prevMedia({
        thumbnailType: 'video',
        thumbnailVideoUrl: 'https://www.youtube.com/watch?v=t',
      }),
    );
    expect(legacy.videoUrl).toBe('https://www.youtube.com/watch?v=t');
    expect(legacy.featuredImageUrl).toBeNull();
    expect(legacy.galleryUrls).toEqual([]);
  });
});

describe('normalizeGalleryLenient (read path)', () => {
  it('tolerates plain strings, drops malformed entries, never throws', () => {
    expect(
      normalizeGalleryLenient(
        ['https://cdn.example.com/a.jpg', { url: 'https://cdn.example.com/b.jpg' }, 42, null, { url: '' }, { noUrl: true }],
        'image',
      ),
    ).toEqual([
      { url: 'https://cdn.example.com/a.jpg' },
      { url: 'https://cdn.example.com/b.jpg' },
    ]);
    expect(normalizeGalleryLenient('not-an-array', 'image')).toEqual([]);
    expect(normalizeGalleryLenient(null, 'video')).toEqual([]);
    expect(normalizeGalleryLenient(undefined, 'video')).toEqual([]);
  });
});

describe('resolveMediaWithLegacyFallback', () => {
  it('prefers new fields when present', () => {
    const resolved = resolveMediaWithLegacyFallback({
      thumbnailType: 'image',
      thumbnailUrl: 'https://cdn.example.com/new.jpg',
      featuredImageUrl: 'https://cdn.example.com/old.jpg',
      videos: [{ url: 'https://cdn.example.com/new.mp4' }],
      videoUrl: 'https://cdn.example.com/old.mp4',
      galleryImages: [{ url: 'https://cdn.example.com/g.jpg' }],
      galleryUrls: ['https://cdn.example.com/old-g.jpg'],
    });
    expect(resolved.thumbnailUrl).toBe('https://cdn.example.com/new.jpg');
    expect(resolved.videos).toEqual([
      { url: 'https://cdn.example.com/new.mp4' },
    ]);
    expect(resolved.galleryImages).toEqual([
      { url: 'https://cdn.example.com/g.jpg' },
    ]);
  });

  it('falls back to legacy columns on a pre-backfill row', () => {
    const resolved = resolveMediaWithLegacyFallback({
      thumbnailType: 'image',
      thumbnailUrl: null,
      thumbnailVideoUrl: null,
      thumbnailAutoplay: false,
      videos: [],
      galleryImages: [],
      featuredImageUrl: '/api/public/media/aaa',
      videoUrl: 'https://youtube.com/watch?v=x',
      galleryUrls: ['/api/public/media/bbb', '/api/public/media/ccc'],
    });
    expect(resolved).toEqual({
      thumbnailType: 'image',
      thumbnailUrl: '/api/public/media/aaa',
      thumbnailVideoUrl: null,
      thumbnailAutoplay: false,
      videos: [{ url: 'https://youtube.com/watch?v=x' }],
      galleryImages: [
        { url: '/api/public/media/bbb' },
        { url: '/api/public/media/ccc' },
      ],
    });
  });

  it('coerces an invalid stored thumbnailType to image', () => {
    const resolved = resolveMediaWithLegacyFallback({
      thumbnailType: 'audio',
    });
    expect(resolved.thumbnailType).toBe('image');
    expect(resolved.videos).toEqual([]);
  });
});

describe('resolveMediaWrite', () => {
  it('lets new fields win over legacy fields in the same DTO', () => {
    const out = resolveMediaWrite({
      thumbnailUrl: 'https://cdn.example.com/new.jpg',
      featuredImageUrl: 'https://cdn.example.com/old.jpg',
      videoUrl: 'https://cdn.example.com/old.mp4',
    });
    expect(out.thumbnailUrl).toBe('https://cdn.example.com/new.jpg');
    expect(out.videos).toEqual([]);
  });

  it('derives new media from legacy fields for an old client', () => {
    const out = resolveMediaWrite({
      featuredImageUrl: 'https://cdn.example.com/old.jpg',
      videoUrl: 'https://www.youtube.com/watch?v=x',
      galleryUrls: ['https://cdn.example.com/g1.jpg'],
    });
    expect(out.thumbnailUrl).toBe('https://cdn.example.com/old.jpg');
    expect(out.videos).toEqual([{ url: 'https://www.youtube.com/watch?v=x' }]);
    expect(out.galleryImages).toEqual([
      { url: 'https://cdn.example.com/g1.jpg' },
    ]);
  });

  it('keeps the previous row when neither new nor legacy fields are sent', () => {
    const out = resolveMediaWrite(
      {},
      prevMedia({ thumbnailUrl: 'https://cdn.example.com/kept.jpg' }),
    );
    expect(out.thumbnailUrl).toBe('https://cdn.example.com/kept.jpg');
  });

  it('clears the video gallery when a legacy client clears videoUrl', () => {
    const out = resolveMediaWrite(
      { videoUrl: null },
      prevMedia({ videos: [{ url: 'https://cdn.example.com/v.mp4' }] }),
    );
    expect(out.videos).toEqual([]);
  });
});
