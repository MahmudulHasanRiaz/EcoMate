import {
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MAX_MEDIA_BYTES,
  mediaKindOfMime,
  mediaObjectKey,
  mediaTypeLabel,
  normalizeFilename,
  normalizeFolder,
  normalizeTags,
  parseImageDimensions,
  sanitizeSvgText,
  verifyMediaBytes,
} from './media-validation';

// 1×1 transparent PNG (dimensions 1×1).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// Minimal JPEG: SOI + SOF0 (10 high × 20 wide).
const JPEG_20X10 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x0a, 0x00, 0x14, 0x03,
  0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
]);

// Minimal WebP VP8X (10 wide × 20 high).
const WEBP_10X20 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1e, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x09, 0x00, 0x00, 0x13, 0x00, 0x00,
]);

// Minimal GIF89a (3 wide × 4 high).
const GIF_3X4 = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x03, 0x00, 0x04, 0x00,
]);

const SVG_10X20 =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><rect width="10" height="20"/></svg>';

describe('media-validation — allowlist + magic bytes', () => {
  it.each([
    ['image/png', PNG_1X1, 1, 1],
    ['image/jpeg', JPEG_20X10, 20, 10],
    ['image/webp', WEBP_10X20, 10, 20],
    ['image/gif', GIF_3X4, 3, 4],
  ])('accepts %s with parsed dimensions', (mime, bytes, w, h) => {
    const out = verifyMediaBytes(bytes as Buffer, mime as string);
    expect(out.kind).toBe('image');
    expect(out.width).toBe(w);
    expect(out.height).toBe(h);
  });

  it('accepts SVG with dimensions from attributes', () => {
    const out = verifyMediaBytes(Buffer.from(SVG_10X20), 'image/svg+xml');
    expect(out.kind).toBe('image');
    expect(out.width).toBe(10);
    expect(out.height).toBe(20);
  });

  it('accepts SVG with dimensions from viewBox', () => {
    const out = verifyMediaBytes(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40"></svg>',
      ),
      'image/svg+xml',
    );
    expect(out.width).toBe(30);
    expect(out.height).toBe(40);
  });

  it.each([
    ['video/mp4', Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), 'video'],
    ['video/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]), 'video'],
    ['audio/mpeg', Buffer.from([0x49, 0x44, 0x33, 0x03]), 'audio'],
    ['audio/mpeg', Buffer.from([0xff, 0xfb, 0x90, 0x00]), 'audio'],
    ['audio/wav', Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), 'audio'],
    ['audio/ogg', Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00]), 'audio'],
    ['application/pdf', Buffer.from('%PDF-1.4 fake'), 'document'],
    ['application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'archive'],
    ['text/plain', Buffer.from('hello world'), 'other'],
    ['text/csv', Buffer.from('a,b\n1,2'), 'other'],
  ])('accepts %s (%s)', (mime, bytes, kind) => {
    const out = verifyMediaBytes(bytes as Buffer, mime as string);
    expect(out.kind).toBe(kind);
    expect(out.width).toBeNull();
  });

  it('rejects an unknown MIME with 415', () => {
    expect(() => verifyMediaBytes(Buffer.from('x'), 'application/x-msdownload')).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects a bad magic signature with 415', () => {
    expect(() => verifyMediaBytes(Buffer.from('not a png'), 'image/png')).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => verifyMediaBytes(PNG_1X1, 'image/jpeg')).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects an empty file with 415', () => {
    expect(() => verifyMediaBytes(Buffer.alloc(0), 'image/png')).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects an oversize file with 413', () => {
    const big = Buffer.concat([PNG_1X1, Buffer.alloc(10)]);
    expect(() =>
      verifyMediaBytes(big, 'image/png', PNG_1X1.length + 5),
    ).toThrow(PayloadTooLargeException);
  });

  it('rejects NUL bytes in text and non-UTF8 text with 415', () => {
    expect(() =>
      verifyMediaBytes(Buffer.from('a\0b'), 'text/plain'),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      verifyMediaBytes(Buffer.from([0xff, 0xfe, 0xfd]), 'text/plain'),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('sanitizes SVG: strips script, handlers, javascript: hrefs, foreignObject, DOCTYPE', () => {
    const dirty = `<!DOCTYPE svg [<!ENTITY x "y">]>
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)">
        <script>alert(2)</script>
        <foreignObject><div>html</div></foreignObject>
        <a href="javascript:alert(3)"><rect width="10" height="10"/></a>
        <a xlink:href="data:text/html,<script>alert(4)</script>"><circle r="1"/></a>
      </svg>`;
    const out = verifyMediaBytes(Buffer.from(dirty), 'image/svg+xml');
    const text = Buffer.from(out.bytes).toString('utf-8');
    expect(text).not.toMatch(/<script/i);
    expect(text).not.toMatch(/onload/i);
    expect(text).not.toMatch(/javascript:/i);
    expect(text).not.toMatch(/foreignObject/i);
    expect(text).not.toMatch(/<!DOCTYPE/i);
    expect(text).not.toMatch(/data:text/i);
    expect(text).toContain('<svg');
    expect(text).toContain('<rect');
  });

  it('accepts a DOCTYPE-prefixed SVG (legitimate) after sanitizing', () => {
    const out = verifyMediaBytes(
      Buffer.from(
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><svg xmlns="http://www.w3.org/2000/svg" width="5" height="6"></svg>',
      ),
      'image/svg+xml',
    );
    expect(out.width).toBe(5);
    expect(out.height).toBe(6);
  });

  it('rejects non-SVG markup declared as SVG', () => {
    expect(() =>
      verifyMediaBytes(Buffer.from('<html><body>nope</body></html>'), 'image/svg+xml'),
    ).toThrow(UnsupportedMediaTypeException);
  });
});

describe('media-validation — kinds + labels', () => {
  it('maps MIME to kind and labels', () => {
    expect(mediaKindOfMime('image/png')).toBe('image');
    expect(mediaKindOfMime('IMAGE/PNG')).toBe('image');
    expect(mediaKindOfMime('application/pdf')).toBe('document');
    expect(mediaKindOfMime('text/csv')).toBe('other');
    expect(mediaKindOfMime('application/octet-stream')).toBeNull();
    expect(mediaTypeLabel('image/svg+xml')).toBe('SVG image');
    expect(mediaTypeLabel('weird/type')).toBe('weird/type');
  });

  it('parseImageDimensions returns null for non-image types', () => {
    expect(parseImageDimensions(PNG_1X1, 'application/pdf')).toBeNull();
  });
});

describe('media-validation — folder / tags / filename', () => {
  it('normalizeFolder: root, lowercase, segments', () => {
    expect(normalizeFolder(undefined)).toBe('');
    expect(normalizeFolder('  ')).toBe('');
    expect(normalizeFolder('Landing/Hero-1')).toBe('landing/hero-1');
    expect(() => normalizeFolder('/leading')).toThrow(UnprocessableEntityException);
    expect(() => normalizeFolder('trailing/')).toThrow(UnprocessableEntityException);
    expect(() => normalizeFolder('a//b')).toThrow(UnprocessableEntityException);
    expect(() => normalizeFolder('a/../b')).toThrow(UnprocessableEntityException);
    expect(() => normalizeFolder('bad segment')).toThrow(
      UnprocessableEntityException,
    );
    expect(() => normalizeFolder('x'.repeat(121))).toThrow(
      UnprocessableEntityException,
    );
  });

  it('normalizeTags: lowercase, dedupe, comma-split, limits', () => {
    expect(normalizeTags(['Hero', 'hero', ' landing '])).toEqual([
      'hero',
      'landing',
    ]);
    expect(normalizeTags('a,b,, c ')).toEqual(['a', 'b', 'c']);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(() => normalizeTags(['bad tag!'])).toThrow(
      UnprocessableEntityException,
    );
    expect(() =>
      normalizeTags(Array.from({ length: 11 }, (_, i) => `t${i}`)),
    ).toThrow(UnprocessableEntityException);
  });

  it('normalizeFilename keeps spaces, strips separators and leading dots', () => {
    expect(normalizeFilename('  my logo v2.png  ')).toBe('my logo v2.png');
    expect(normalizeFilename('a/b\\c:d.png')).toBe('a_b_c_d.png');
    expect(normalizeFilename('...hidden')).toBe('hidden');
    expect(() => normalizeFilename('   ')).toThrow(UnprocessableEntityException);
    expect(() => normalizeFilename('...')).toThrow(UnprocessableEntityException);
  });

  it('mediaObjectKey: media/YYYY/MM/<uuid>-<sanitized>', () => {
    const key = mediaObjectKey('My Logo v2.PNG', new Date('2026-11-18T00:00:00Z'));
    expect(key).toMatch(/^media\/2026\/11\/[0-9a-f-]{36}-My-Logo-v2\.PNG$/);
    expect(mediaObjectKey('a/b.png')).toMatch(/^media\/\d{4}\/\d{2}\//);
    expect(mediaObjectKey('a/b.png')).not.toContain('//');
  });
});

describe('media-validation — sanitizeSvgText', () => {
  it('keeps data:image hrefs (only javascript:/data:text are stripped)', () => {
    const out = sanitizeSvgText(
      '<svg><image href="data:image/png;base64,AAAA"/></svg>',
    );
    expect(out).toContain('data:image/png;base64,AAAA');
  });
});

describe('media-validation — MAX_MEDIA_BYTES', () => {
  it('is 100 MB', () => {
    expect(MAX_MEDIA_BYTES).toBe(100 * 1024 * 1024);
  });
});
