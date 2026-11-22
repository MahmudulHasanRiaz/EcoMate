import { describe, expect, it } from 'vitest';
import {
  addGalleryEntry,
  effectiveReviewFormat,
  emptyMediaValue,
  hasVideo,
  isDirectVideoFile,
  isMediaLibraryUrl,
  mediaValueFromRow,
  moveGalleryEntry,
  normalizeMediaImage,
  normalizeMediaValue,
  normalizeMediaVideo,
  removeGalleryEntry,
  resolveThumbnail,
  updateGalleryEntry,
  videoEmbedUrl,
  type ContentMediaValue,
  type MediaImageEntry,
} from './content-media';

function media(overrides: Partial<ContentMediaValue> = {}): ContentMediaValue {
  return { ...emptyMediaValue(), ...overrides };
}

describe('normalizeMediaImage / normalizeMediaVideo', () => {
  it('reads a plain string as { url } (Portfolio-V3 tolerance)', () => {
    expect(normalizeMediaImage('https://cdn.example.com/a.jpg')).toEqual({
      url: 'https://cdn.example.com/a.jpg',
    });
    expect(normalizeMediaVideo('https://cdn.example.com/v.mp4')).toEqual({
      url: 'https://cdn.example.com/v.mp4',
    });
  });

  it('strips unknown keys and trims fields', () => {
    expect(
      normalizeMediaImage({
        url: '  https://cdn.example.com/a.jpg ',
        alt: ' Front ',
        caption: '',
        extra: 1,
      }),
    ).toEqual({ url: 'https://cdn.example.com/a.jpg', alt: 'Front' });
    expect(
      normalizeMediaVideo({
        url: 'https://cdn.example.com/v.mp4',
        title: 'Intro',
        duration: '2:41',
      }),
    ).toEqual({
      url: 'https://cdn.example.com/v.mp4',
      title: 'Intro',
      duration: '2:41',
    });
  });

  it('returns null for malformed entries', () => {
    expect(normalizeMediaImage('')).toBeNull();
    expect(normalizeMediaImage(42)).toBeNull();
    expect(normalizeMediaImage({ url: '' })).toBeNull();
    expect(normalizeMediaImage({ noUrl: true })).toBeNull();
    expect(normalizeMediaImage(null)).toBeNull();
  });
});

describe('normalizeMediaValue', () => {
  it('normalizes a full value and dedupes galleries', () => {
    expect(
      normalizeMediaValue({
        thumbnailType: 'video',
        thumbnailUrl: 'https://cdn.example.com/poster.jpg',
        thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
        thumbnailAutoplay: true,
        videos: [
          'https://www.youtube.com/watch?v=x',
          { url: 'https://www.youtube.com/watch?v=x' },
        ],
        galleryImages: ['https://cdn.example.com/a.jpg', 42, null],
      }),
    ).toEqual({
      thumbnailType: 'video',
      thumbnailUrl: 'https://cdn.example.com/poster.jpg',
      thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
      thumbnailAutoplay: true,
      videos: [{ url: 'https://www.youtube.com/watch?v=x' }],
      galleryImages: [{ url: 'https://cdn.example.com/a.jpg' }],
    });
  });

  it('degrades a malformed value to defaults, never throws', () => {
    expect(normalizeMediaValue(null)).toEqual(emptyMediaValue());
    expect(normalizeMediaValue('nope')).toEqual(emptyMediaValue());
    expect(
      normalizeMediaValue({ thumbnailType: 'audio', videos: 'nope' }),
    ).toEqual(emptyMediaValue());
  });
});

describe('mediaValueFromRow (legacy fallback)', () => {
  it('fills empty new fields from the legacy columns', () => {
    expect(
      mediaValueFromRow({
        thumbnailType: 'image',
        thumbnailUrl: null,
        videos: [],
        galleryImages: [],
        featuredImageUrl: '/api/public/media/aaa',
        videoUrl: 'https://youtube.com/watch?v=x',
        galleryUrls: ['/api/public/media/bbb'],
      }),
    ).toEqual({
      thumbnailType: 'image',
      thumbnailUrl: '/api/public/media/aaa',
      thumbnailVideoUrl: '',
      thumbnailAutoplay: false,
      videos: [{ url: 'https://youtube.com/watch?v=x' }],
      galleryImages: [{ url: '/api/public/media/bbb' }],
    });
  });

  it('prefers the new fields when present', () => {
    const value = mediaValueFromRow({
      thumbnailUrl: 'https://cdn.example.com/new.jpg',
      videos: [{ url: 'https://cdn.example.com/new.mp4' }],
      galleryImages: [{ url: 'https://cdn.example.com/g.jpg' }],
      featuredImageUrl: 'https://cdn.example.com/old.jpg',
      videoUrl: 'https://cdn.example.com/old.mp4',
      galleryUrls: ['https://cdn.example.com/old-g.jpg'],
    });
    expect(value.thumbnailUrl).toBe('https://cdn.example.com/new.jpg');
    expect(value.videos).toEqual([{ url: 'https://cdn.example.com/new.mp4' }]);
    expect(value.galleryImages).toEqual([
      { url: 'https://cdn.example.com/g.jpg' },
    ]);
  });
});

describe('resolveThumbnail / hasVideo', () => {
  it('resolves the thumbnail or null', () => {
    expect(
      resolveThumbnail(media({ thumbnailUrl: 'https://cdn.example.com/a.jpg' })),
    ).toBe('https://cdn.example.com/a.jpg');
    expect(resolveThumbnail(media())).toBeNull();
  });

  it('detects video from the gallery or a video thumbnail', () => {
    expect(hasVideo(media())).toBe(false);
    expect(
      hasVideo(media({ videos: [{ url: 'https://cdn.example.com/v.mp4' }] })),
    ).toBe(true);
    expect(
      hasVideo(
        media({
          thumbnailType: 'video',
          thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
        }),
      ),
    ).toBe(true);
    expect(
      hasVideo(media({ thumbnailType: 'video', thumbnailVideoUrl: '' })),
    ).toBe(false);
  });
});

describe('effectiveReviewFormat (§3.1 mirror)', () => {
  it('keeps a stored video format when the video is present', () => {
    expect(
      effectiveReviewFormat(
        'video_short',
        media({ videos: [{ url: 'https://cdn.example.com/v.mp4' }] }),
      ),
    ).toBe('video_short');
  });

  it('derives video_standard when media says video but the format is stale', () => {
    expect(
      effectiveReviewFormat(
        'text',
        media({ videos: [{ url: 'https://cdn.example.com/v.mp4' }] }),
      ),
    ).toBe('video_standard');
  });

  it('degrades a stored video format with no video to image/text', () => {
    expect(
      effectiveReviewFormat(
        'video_standard',
        media({ thumbnailUrl: 'https://cdn.example.com/a.jpg' }),
      ),
    ).toBe('image');
    expect(effectiveReviewFormat('video_short', media())).toBe('text');
  });

  it('returns image for a photo-only review, text otherwise', () => {
    expect(
      effectiveReviewFormat(
        'text',
        media({ galleryImages: [{ url: 'https://cdn.example.com/a.jpg' }] }),
      ),
    ).toBe('image');
    expect(effectiveReviewFormat('text', media())).toBe('text');
  });
});

describe('videoEmbedUrl / isDirectVideoFile', () => {
  it('builds YouTube + Vimeo embed URLs', () => {
    expect(
      videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(
      videoEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    ).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://vimeo.com/123456')).toBe(
      'https://player.vimeo.com/video/123456',
    );
  });

  it('returns null for direct files, media-library URLs and garbage', () => {
    expect(videoEmbedUrl('https://cdn.example.com/v.mp4')).toBeNull();
    expect(videoEmbedUrl('/api/public/media/abc')).toBeNull();
    expect(videoEmbedUrl('not a url')).toBeNull();
    expect(videoEmbedUrl('')).toBeNull();
  });

  it('detects direct video files', () => {
    expect(isDirectVideoFile('https://cdn.example.com/v.mp4')).toBe(true);
    expect(isDirectVideoFile('https://cdn.example.com/v.webm?t=1')).toBe(true);
    expect(isDirectVideoFile('https://cdn.example.com/v.mov')).toBe(false);
    expect(isDirectVideoFile('https://www.youtube.com/watch?v=x')).toBe(false);
  });

  it('treats media-library URLs as playable files (console preview)', () => {
    // Extension-less media-library URLs (relative + absolute) play
    // in the preview <video> — the picker produces the absolute
    // form via resolveAbsoluteMediaUrl.
    expect(isDirectVideoFile('/api/public/media/abc')).toBe(true);
    expect(
      isDirectVideoFile('https://api.example.com/api/public/media/abc'),
    ).toBe(true);
    expect(isDirectVideoFile('/api/public/media/abc?download=1')).toBe(true);
    // Other relative URLs are unchanged: no extension, no playback.
    expect(isDirectVideoFile('/media/clip.mov')).toBe(false);
    expect(isDirectVideoFile('/files/video')).toBe(false);
  });
});

describe('isMediaLibraryUrl', () => {
  it('matches relative and absolute media-library URLs', () => {
    expect(isMediaLibraryUrl('/api/public/media/abc')).toBe(true);
    expect(
      isMediaLibraryUrl('https://api.example.com/api/public/media/abc'),
    ).toBe(true);
    expect(isMediaLibraryUrl('/public/media/abc')).toBe(true);
    expect(isMediaLibraryUrl('/api/public/media/abc?t=1#frag')).toBe(true);
  });

  it('rejects direct files, embeds, other paths and garbage', () => {
    expect(isMediaLibraryUrl('https://cdn.example.com/v.mp4')).toBe(false);
    expect(
      isMediaLibraryUrl('https://www.youtube.com/watch?v=x'),
    ).toBe(false);
    expect(isMediaLibraryUrl('/media/clip.mp4')).toBe(false);
    expect(isMediaLibraryUrl('/api/public/blog/abc')).toBe(false);
    expect(isMediaLibraryUrl('not a url')).toBe(false);
    expect(isMediaLibraryUrl('')).toBe(false);
  });
});

describe('gallery list helpers', () => {
  it('addGalleryEntry appends, dedupes, and refuses over the cap', () => {
    const entries = [{ url: 'https://cdn.example.com/a.jpg' }];
    expect(
      addGalleryEntry(entries, { url: 'https://cdn.example.com/b.jpg' }, 2),
    ).toEqual([
      { url: 'https://cdn.example.com/a.jpg' },
      { url: 'https://cdn.example.com/b.jpg' },
    ]);
    expect(
      addGalleryEntry(entries, { url: 'https://cdn.example.com/a.jpg' }, 2),
    ).toEqual(entries);
    expect(
      addGalleryEntry(
        [
          { url: 'https://cdn.example.com/a.jpg' },
          { url: 'https://cdn.example.com/b.jpg' },
        ],
        { url: 'https://cdn.example.com/c.jpg' },
        2,
      ),
    ).toBeNull();
  });

  it('removeGalleryEntry drops by index', () => {
    expect(removeGalleryEntry(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('moveGalleryEntry swaps one step and holds at the edges', () => {
    expect(moveGalleryEntry(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveGalleryEntry(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveGalleryEntry(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveGalleryEntry(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('updateGalleryEntry patches one entry', () => {
    expect(
      updateGalleryEntry<MediaImageEntry>(
        [{ url: 'https://cdn.example.com/a.jpg' }],
        0,
        { alt: 'Front' },
      ),
    ).toEqual([{ url: 'https://cdn.example.com/a.jpg', alt: 'Front' }]);
  });
});
