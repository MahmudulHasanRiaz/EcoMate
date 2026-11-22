import { describe, expect, it } from 'vitest';
import {
  folderLabel,
  formatBytes,
  mediaAcceptForKinds,
  mediaKindOfMime,
  mediaQueryString,
  resolveAbsoluteMediaUrl,
  resolveMediaUrl,
  userAvatarUrl,
  MEDIA_KIND_LABELS,
  MEDIA_KINDS,
} from './media';

describe('media lib — kinds', () => {
  it('covers six kinds with labels', () => {
    expect(MEDIA_KINDS).toEqual([
      'image',
      'video',
      'audio',
      'document',
      'archive',
      'other',
    ]);
    expect(MEDIA_KIND_LABELS.image).toBe('Images');
    expect(MEDIA_KIND_LABELS.document).toBe('Documents');
  });

  it('mediaKindOfMime maps MIME to kind', () => {
    expect(mediaKindOfMime('image/png')).toBe('image');
    expect(mediaKindOfMime('IMAGE/SVG+XML')).toBe('image');
    expect(mediaKindOfMime('video/webm')).toBe('video');
    expect(mediaKindOfMime('audio/ogg')).toBe('audio');
    expect(mediaKindOfMime('application/pdf')).toBe('document');
    expect(mediaKindOfMime('application/x-zip-compressed')).toBe('archive');
    expect(mediaKindOfMime('text/csv')).toBe('other');
    expect(mediaKindOfMime('application/octet-stream')).toBeNull();
  });

  it('mediaAcceptForKinds builds the file-input accept list', () => {
    expect(mediaAcceptForKinds(['image'])).toBe(
      'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
    );
    const all = mediaAcceptForKinds();
    expect(all).toContain('image/png');
    expect(all).toContain('video/mp4');
    expect(all).toContain('application/pdf');
    expect(all).toContain('text/csv');
  });
});

describe('media lib — resolveMediaUrl', () => {
  it('passes absolute URLs through', () => {
    expect(
      resolveMediaUrl(
        'https://api.staging.ecomate.bd/api/public/media/abc',
        'http://127.0.0.1:4100/api',
      ),
    ).toBe('https://api.staging.ecomate.bd/api/public/media/abc');
  });

  it('resolves a relative path against a dev API base', () => {
    expect(
      resolveMediaUrl(
        '/api/public/media/abc',
        'http://127.0.0.1:4101/api',
      ),
    ).toBe('http://127.0.0.1:4101/api/public/media/abc');
  });

  it('leaves a relative path alone for the same-origin base', () => {
    expect(resolveMediaUrl('/api/public/media/abc', '/api')).toBe(
      '/api/public/media/abc',
    );
  });

  it('resolveAbsoluteMediaUrl pins a relative path to the console origin', () => {
    const url = resolveAbsoluteMediaUrl(
      '/api/public/media/abc',
      '/api',
      'http://console.test',
    );
    expect(url).toBe('http://console.test/api/public/media/abc');
    expect(
      resolveAbsoluteMediaUrl(
        'https://api.staging.ecomate.bd/api/public/media/abc',
        '/api',
        'http://console.test',
      ),
    ).toBe('https://api.staging.ecomate.bd/api/public/media/abc');
  });
});

describe('media lib — folderLabel + formatBytes', () => {
  it('labels folders', () => {
    expect(folderLabel('')).toBe('Root');
    expect(folderLabel('landing')).toBe('landing');
    expect(folderLabel('landing/hero')).toBe('landing / hero');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
    expect(formatBytes(NaN)).toBe('—');
  });
});

describe('media lib — userAvatarUrl', () => {
  const user = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    avatarKey: 'media/2026/11/uuid-photo.png',
  };

  it('builds the public avatar URL with the key as cache-buster', () => {
    expect(userAvatarUrl(user, '/api')).toBe(
      '/api/public/avatar/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?k=media%2F2026%2F11%2Fuuid-photo.png',
    );
  });

  it('resolves against a dev API base', () => {
    expect(userAvatarUrl(user, 'http://127.0.0.1:4100/api')).toBe(
      'http://127.0.0.1:4100/api/public/avatar/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?k=media%2F2026%2F11%2Fuuid-photo.png',
    );
  });

  it('returns null when the user has no custom photo', () => {
    expect(userAvatarUrl({ id: user.id, avatarKey: null }, '/api')).toBeNull();
    expect(userAvatarUrl({ id: user.id }, '/api')).toBeNull();
  });
});

describe('media lib — mediaQueryString', () => {
  it('builds list + upload query strings, skipping empties', () => {
    expect(
      mediaQueryString({ q: 'hero', kind: 'image', folder: '', limit: 24 }),
    ).toBe('?q=hero&kind=image&limit=24');
    expect(mediaQueryString({ folder: 'landing', tags: ['a', 'b'] })).toBe(
      '?folder=landing&tags=a%2Cb',
    );
    expect(mediaQueryString({})).toBe('');
    expect(mediaQueryString({ q: '', mimes: [] })).toBe('');
  });
});
