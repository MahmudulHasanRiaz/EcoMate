import { describe, expect, it } from 'vitest';
import {
  effectiveFormat,
  hasVideo,
  isDirectVideoFile,
  isMediaLibraryUrl,
  normalizeMedia,
  normalizeMediaImage,
  normalizeMediaVideo,
  resolveMedia,
  resolveThumbnail,
  videoEmbedUrl,
  type ContentMedia,
} from '../content-media';

const IMAGE_MEDIA: ContentMedia = {
  thumbnailType: 'image',
  thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
  thumbnailVideoUrl: null,
  thumbnailAutoplay: false,
  videos: [],
  galleryImages: [{ url: 'https://cdn.example.com/g1.jpg', alt: 'One' }],
};

const VIDEO_MEDIA: ContentMedia = {
  thumbnailType: 'video',
  thumbnailUrl: 'https://cdn.example.com/poster.jpg',
  thumbnailVideoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  thumbnailAutoplay: false,
  videos: [],
  galleryImages: [],
};

describe('normalizeMediaImage / normalizeMediaVideo', () => {
  it('accepts plain strings (defensive, §2.2)', () => {
    expect(normalizeMediaImage('https://cdn.example.com/a.jpg')).toEqual({
      url: 'https://cdn.example.com/a.jpg',
    });
    expect(normalizeMediaVideo('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
    });
  });

  it('strips unknown keys and drops malformed entries', () => {
    expect(
      normalizeMediaImage({ url: 'https://a.jpg', alt: 'A', extra: 1 }),
    ).toEqual({ url: 'https://a.jpg', alt: 'A' });
    expect(normalizeMediaImage({ url: '  ' })).toBeNull();
    expect(normalizeMediaImage({})).toBeNull();
    expect(normalizeMediaImage(42)).toBeNull();
    expect(normalizeMediaImage(null)).toBeNull();
    expect(
      normalizeMediaVideo({ url: 'https://v.mp4', duration: '2:41' }),
    ).toEqual({ url: 'https://v.mp4', duration: '2:41' });
  });
});

describe('normalizeMedia', () => {
  it('normalizes a full row and dedupes gallery URLs', () => {
    expect(
      normalizeMedia({
        thumbnailType: 'video',
        thumbnailUrl: 'https://cdn.example.com/p.jpg',
        thumbnailVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        thumbnailAutoplay: true,
        videos: [
          'https://youtu.be/dQw4w9WgXcQ',
          'https://youtu.be/dQw4w9WgXcQ',
          { url: 'https://v.mp4', title: 'Demo' },
        ],
        galleryImages: ['https://cdn.example.com/g.jpg'],
      }),
    ).toEqual({
      thumbnailType: 'video',
      thumbnailUrl: 'https://cdn.example.com/p.jpg',
      thumbnailVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
      thumbnailAutoplay: true,
      videos: [
        { url: 'https://youtu.be/dQw4w9WgXcQ' },
        { url: 'https://v.mp4', title: 'Demo' },
      ],
      galleryImages: [{ url: 'https://cdn.example.com/g.jpg' }],
    });
  });

  it('degrades a malformed value to defaults, never throws', () => {
    expect(normalizeMedia(null)).toEqual({
      thumbnailType: 'image',
      thumbnailUrl: null,
      thumbnailVideoUrl: null,
      thumbnailAutoplay: false,
      videos: [],
      galleryImages: [],
    });
    expect(normalizeMedia('nope')).toEqual(normalizeMedia(null));
    expect(normalizeMedia({ thumbnailType: 'sideways' }).thumbnailType).toBe(
      'image',
    );
  });
});

describe('resolveMedia (legacy fallback, §4.3)', () => {
  it('prefers the new fields when present, per field', () => {
    // The fallback is per field: the non-empty thumbnail + gallery
    // win over the legacy columns, while the EMPTY videos gallery
    // fills from the legacy videoUrl.
    expect(
      resolveMedia({
        ...IMAGE_MEDIA,
        featuredImageUrl: 'https://cdn.example.com/old.jpg',
        videoUrl: 'https://youtu.be/old',
        galleryUrls: ['https://cdn.example.com/old-g.jpg'],
      }),
    ).toEqual({
      ...IMAGE_MEDIA,
      videos: [{ url: 'https://youtu.be/old' }],
    });
  });

  it('fills empty new fields from the legacy columns', () => {
    expect(
      resolveMedia({
        featuredImageUrl: 'https://cdn.example.com/old.jpg',
        videoUrl: 'https://youtu.be/old',
        galleryUrls: ['https://cdn.example.com/old-g.jpg', 'bad', ''],
      }),
    ).toEqual({
      thumbnailType: 'image',
      thumbnailUrl: 'https://cdn.example.com/old.jpg',
      thumbnailVideoUrl: null,
      thumbnailAutoplay: false,
      videos: [{ url: 'https://youtu.be/old' }],
      galleryImages: [
        { url: 'https://cdn.example.com/old-g.jpg' },
        { url: 'bad' },
      ],
    });
  });

  it('returns empty media for a row with nothing', () => {
    expect(resolveMedia({})).toEqual({
      thumbnailType: 'image',
      thumbnailUrl: null,
      thumbnailVideoUrl: null,
      thumbnailAutoplay: false,
      videos: [],
      galleryImages: [],
    });
  });
});

describe('resolveThumbnail / hasVideo', () => {
  it('returns the thumbnail image, never a gallery image', () => {
    expect(resolveThumbnail(IMAGE_MEDIA)).toBe(
      'https://cdn.example.com/thumb.jpg',
    );
    expect(
      resolveThumbnail({ ...IMAGE_MEDIA, thumbnailUrl: null }),
    ).toBeNull();
  });

  it('detects video from the thumbnail or the gallery', () => {
    expect(hasVideo(IMAGE_MEDIA)).toBe(false);
    expect(hasVideo(VIDEO_MEDIA)).toBe(true);
    expect(
      hasVideo({ ...IMAGE_MEDIA, videos: [{ url: 'https://v.mp4' }] }),
    ).toBe(true);
  });
});

describe('effectiveFormat (§3.1)', () => {
  it('video wins when a video URL exists', () => {
    expect(effectiveFormat('text', VIDEO_MEDIA)).toBe('video_standard');
    expect(effectiveFormat('video_short', VIDEO_MEDIA)).toBe('video_short');
    expect(
      effectiveFormat('video_standard', {
        ...IMAGE_MEDIA,
        videos: [{ url: 'https://v.mp4' }],
      }),
    ).toBe('video_standard');
  });

  it('downgrades a video claim without video to image, then text', () => {
    expect(effectiveFormat('video_standard', IMAGE_MEDIA)).toBe('image');
    // Gallery images alone count as image (§3.1 hasImage) — the
    // thumbnail is not the only image source.
    expect(
      effectiveFormat('video_standard', {
        ...IMAGE_MEDIA,
        thumbnailUrl: null,
      }),
    ).toBe('image');
    expect(
      effectiveFormat('video_standard', {
        ...IMAGE_MEDIA,
        thumbnailUrl: null,
        galleryImages: [],
      }),
    ).toBe('text');
    expect(effectiveFormat('image', IMAGE_MEDIA)).toBe('image');
  });

  it('treats a video thumbnail with no URL + gallery videos as video', () => {
    // §3.1 hasVideo: the gallery counts even when the video-type
    // thumbnail has no URL of its own.
    expect(
      effectiveFormat('text', {
        ...IMAGE_MEDIA,
        thumbnailType: 'video',
        thumbnailVideoUrl: null,
        videos: [{ url: 'https://v.mp4' }],
      }),
    ).toBe('video_standard');
    expect(
      effectiveFormat('video_short', {
        ...IMAGE_MEDIA,
        thumbnailType: 'video',
        thumbnailVideoUrl: null,
        videos: [{ url: 'https://v.mp4' }],
      }),
    ).toBe('video_short');
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

  it('treats media-library URLs as playable files', () => {
    // Extension-less media-library URLs (relative + absolute) play
    // in a <video> element — the console picker produces the
    // absolute form, stored rows may hold the relative form.
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
