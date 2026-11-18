import {
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * Media-library file validation (StackMate ADR-0011 pattern, ported).
 *
 * The library accepts an ALLOWLIST of types only — every accepted type
 * is validated by magic bytes (never by extension or declared MIME
 * alone).
 *
 * SVG is XML text: it must parse as SVG markup and is SANITIZED on
 * upload (no <script>, no on* handlers, no javascript:/data:text hrefs,
 * no <foreignObject>, no DOCTYPE) — the STORED bytes are the sanitized
 * bytes, so a stored SVG can never carry an active payload even if it
 * is later served top-level (the public content endpoint additionally
 * serves SVG with a sandbox CSP header; previews use <img> only).
 *
 * Image dimensions are parsed from the file headers (PNG/JPEG/WEBP/GIF
 * + SVG viewBox/attributes) — best-effort, null when unparseable; a
 * valid magic match with unparseable dimensions still stores.
 */

/** Library per-file cap: 100 MB (same as StackMate's library cap). */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export type MediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'other';

export const MEDIA_KINDS: readonly MediaKind[] = [
  'image',
  'video',
  'audio',
  'document',
  'archive',
  'other',
];

/** mime → kind. Anything not in this map is rejected with 415. */
export const MEDIA_ALLOWED_MIME: Readonly<Record<string, MediaKind>> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/ogg': 'audio',
  'application/pdf': 'document',
  'application/zip': 'archive',
  'application/x-zip-compressed': 'archive',
  'text/plain': 'other',
  'text/csv': 'other',
};

export function mediaKindOfMime(mime: string): MediaKind | null {
  return MEDIA_ALLOWED_MIME[mime.trim().toLowerCase()] ?? null;
}

/** kind → the exact MIME types in it (for the list `kind` filter). */
export const KIND_MIMES: Record<MediaKind, readonly string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg'],
  document: ['application/pdf'],
  archive: ['application/zip', 'application/x-zip-compressed'],
  other: ['text/plain', 'text/csv'],
};

const MEDIA_TYPE_LABELS: Readonly<Record<string, string>> = {
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'image/webp': 'WebP image',
  'image/gif': 'GIF image',
  'image/svg+xml': 'SVG image',
  'video/mp4': 'MP4 video',
  'video/webm': 'WebM video',
  'audio/mpeg': 'MP3 audio',
  'audio/wav': 'WAV audio',
  'audio/x-wav': 'WAV audio',
  'audio/ogg': 'OGG audio',
  'application/pdf': 'PDF document',
  'application/zip': 'ZIP archive',
  'application/x-zip-compressed': 'ZIP archive',
  'text/plain': 'Text file',
  'text/csv': 'CSV file',
};

export function mediaTypeLabel(mime: string): string {
  return MEDIA_TYPE_LABELS[mime.trim().toLowerCase()] ?? mime;
}

function unsupported(mime: string): UnsupportedMediaTypeException {
  return new UnsupportedMediaTypeException(
    `Unsupported content type '${mime}'. Allowed: PNG, JPEG, WEBP, GIF, SVG, MP4, WebM, MP3, WAV, OGG, PDF, ZIP, plain text, CSV.`,
  );
}

function badSignature(
  mime: string,
  expected: string,
): UnsupportedMediaTypeException {
  return new UnsupportedMediaTypeException(
    `File signature does not match ${expected} (${mediaTypeLabel(mime)}).`,
  );
}

function u16le(b: Uint8Array, off: number): number {
  return b[off]! | (b[off + 1]! << 8);
}

function u16be(b: Uint8Array, off: number): number {
  return (b[off]! << 8) | b[off + 1]!;
}

function u32be(b: Uint8Array, off: number): number {
  return (
    (b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!
  );
}

/** PNG: IHDR width/height are big-endian uint32 at offsets 16 / 20. */
function parsePngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

/** GIF: width/height are little-endian uint16 at offsets 6 / 8. */
function parseGifDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.byteLength < 10) return null;
  return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

/** JPEG: scan segments for a Start-Of-Frame marker (0xC0–0xCF except 0xC4/0xC8/0xCC); height/width follow the length + precision bytes. */
function parseJpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let off = 2;
  while (off + 9 < bytes.byteLength) {
    if (bytes[off] !== 0xff) return null;
    const marker = bytes[off + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xda) return null; // start of scan — no SOF before it
    const segLen = u16be(bytes, off + 2);
    if (segLen < 2 || off + 2 + segLen > bytes.byteLength) return null;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { width: u16be(bytes, off + 7), height: u16be(bytes, off + 5) };
    }
    off += 2 + segLen;
  }
  return null;
}

/** WebP: VP8X (width-1/height-1, 24-bit LE at 24/27), VP8L (14-bit at 21/23), lossy VP8 (14-bit at 26/28 after the 0x9D012A keyframe tag). */
function parseWebpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.byteLength < 30) return null;
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk === 'VP8X') {
    const w = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    const h = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
    return { width: w, height: h };
  }
  if (chunk === 'VP8L') {
    const b = bytes;
    const w = (b[21]! | ((b[22]! & 0x3f) << 8)) + 1;
    const h = ((b[22]! >> 6) | (b[23]! << 2) | ((b[24]! & 0x0f) << 10)) + 1;
    return { width: w, height: h };
  }
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const w = bytes[26]! | ((bytes[27]! & 0x3f) << 8);
    const h = (bytes[27]! >> 6) | (bytes[28]! << 2) | ((bytes[29]! & 0x0f) << 10);
    return { width: w, height: h };
  }
  return null;
}

/** SVG: width/height attributes (px numbers) or the viewBox's 3rd/4th values. Best-effort. */
function parseSvgDimensions(
  text: string,
): { width: number; height: number } | null {
  const svgTag = text.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  if (!svgTag) return null;
  const attr = (name: string): number | null => {
    const m = svgTag.match(
      new RegExp(`${name}\\s*=\\s*["']([0-9]+(?:\\.[0-9]+)?)(?:px)?["']`, 'i'),
    );
    if (!m) return null;
    const n = Math.round(Number(m[1]));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const w = attr('width');
  const h = attr('height');
  if (w !== null && h !== null) return { width: w, height: h };
  const vb = svgTag.match(/viewBox\s*=\s*["']([0-9.\s-]+)["']/i)?.[1];
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const vw = Math.round(parts[2]!);
      const vh = Math.round(parts[3]!);
      if (vw > 0 && vh > 0) return { width: vw, height: vh };
    }
  }
  return null;
}

export function parseImageDimensions(
  bytes: Uint8Array,
  mime: string,
  svgText?: string,
): { width: number; height: number } | null {
  switch (mime) {
    case 'image/png':
      return parsePngDimensions(bytes);
    case 'image/jpeg':
      return parseJpegDimensions(bytes);
    case 'image/webp':
      return parseWebpDimensions(bytes);
    case 'image/gif':
      return parseGifDimensions(bytes);
    case 'image/svg+xml':
      return svgText ? parseSvgDimensions(svgText) : null;
    default:
      return null;
  }
}

/**
 * Strip everything from SVG markup that can carry active content.
 * The stored bytes are the RETURNED text re-encoded — never the raw
 * upload. Removes: DOCTYPE (ENTITY declarations), <script>, event
 * handler attributes (on*), javascript:/data:text hrefs,
 * <foreignObject> (embedded HTML). Leaves presentation markup alone.
 */
export function sanitizeSvgText(text: string): string {
  let out = text;
  // DOCTYPE, with or without an internal subset: `<!DOCTYPE svg [<!ENTITY
  // x "y">]>` carries a `>` INSIDE the subset, so a naive `[^>]*>` strip
  // stops early and leaves `]>` behind (which then fails the <svg>-root
  // check). Consume up to the subset's closing `]>` when one exists.
  // The pre-subset run excludes both `[` and `>` so a subset-less
  // DOCTYPE cannot swallow the rest of the document.
  out = out.replace(/<!DOCTYPE[^[\]>]*(\[[\s\S]*?\]\s*>|>)/gi, '');
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<script\b[^>]*\/>/gi, '');
  out = out.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '');
  out = out.replace(/<foreignObject\b[^>]*\/>/gi, '');
  // Event handlers: on<name>="..." / on<name>='...' / on<name>=bare.
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // javascript: / data:text hrefs (both href and xlink:href). data:image/* stays.
  out = out.replace(
    /(\s(?:xlink:)?href\s*=\s*["'])\s*(?:javascript:|data:text)[^"']*(["'])/gi,
    '$1#$2',
  );
  return out;
}

function verifySvg(bytes: Uint8Array): {
  sanitizedBytes: Uint8Array;
  dimensions: { width: number; height: number } | null;
} {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Sanitize FIRST (strips the DOCTYPE, which may legally precede the
  // <svg> root), then require the root element to be <svg> — a
  // DOCTYPE-first document is legitimate SVG, a non-SVG document is
  // not. The stored bytes are always the sanitized text.
  const clean = sanitizeSvgText(raw);
  const root = clean
    .trimStart()
    .replace(/^(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)*/, '');
  if (!root.startsWith('<svg')) {
    throw new UnsupportedMediaTypeException(
      'File does not look like SVG markup.',
    );
  }
  return {
    sanitizedBytes: new TextEncoder().encode(clean),
    dimensions: parseSvgDimensions(clean),
  };
}

function verifyText(bytes: Uint8Array, mime: string): void {
  // Text/CSV must decode as UTF-8 with no NUL bytes (binary masquerading as text).
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) {
      throw new UnsupportedMediaTypeException(
        `File contains NUL bytes; not valid ${mediaTypeLabel(mime)}.`,
      );
    }
  } catch (err) {
    if (err instanceof UnsupportedMediaTypeException) throw err;
    throw new UnsupportedMediaTypeException(
      `File is not valid UTF-8 text (${mediaTypeLabel(mime)}).`,
    );
  }
}

export interface VerifiedMedia {
  kind: MediaKind;
  /** For SVG: the SANITIZED bytes (store these, not the upload). Otherwise the input bytes. */
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
}

/**
 * Validate a media-library upload: size cap, allowlisted MIME, magic
 * bytes. Returns the bytes to store (sanitized for SVG) + dimensions.
 */
export function verifyMediaBytes(
  bytes: Uint8Array,
  declaredMimeType: string,
  maxBytes: number = MAX_MEDIA_BYTES,
): VerifiedMedia {
  const mime = declaredMimeType.trim().toLowerCase();
  const kind = mediaKindOfMime(mime);
  if (!kind) throw unsupported(declaredMimeType);
  if (bytes.byteLength === 0) {
    throw new UnsupportedMediaTypeException('Uploaded file is empty.');
  }
  if (bytes.byteLength > maxBytes) {
    throw new PayloadTooLargeException(
      `Uploaded file exceeds the media library maximum of ${maxBytes} bytes.`,
    );
  }

  switch (mime) {
    case 'image/png': {
      const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (!sig.every((b, i) => bytes[i] === b)) throw badSignature(mime, 'PNG');
      const d = parsePngDimensions(bytes);
      return { kind, bytes, width: d?.width ?? null, height: d?.height ?? null };
    }
    case 'image/jpeg': {
      if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
        throw badSignature(mime, 'JPEG');
      }
      const d = parseJpegDimensions(bytes);
      return { kind, bytes, width: d?.width ?? null, height: d?.height ?? null };
    }
    case 'image/webp': {
      const isRiff =
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
      const isWebp =
        bytes.byteLength >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50;
      if (!isRiff || !isWebp) throw badSignature(mime, 'WEBP');
      const d = parseWebpDimensions(bytes);
      return { kind, bytes, width: d?.width ?? null, height: d?.height ?? null };
    }
    case 'image/gif': {
      const head = String.fromCharCode(
        bytes[0]!,
        bytes[1]!,
        bytes[2]!,
        bytes[3]!,
        bytes[4]!,
        bytes[5]!,
      );
      if (head !== 'GIF87a' && head !== 'GIF89a') throw badSignature(mime, 'GIF');
      const d = parseGifDimensions(bytes);
      return { kind, bytes, width: d?.width ?? null, height: d?.height ?? null };
    }
    case 'image/svg+xml': {
      const { sanitizedBytes, dimensions } = verifySvg(bytes);
      return {
        kind,
        bytes: sanitizedBytes,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      };
    }
    case 'video/mp4': {
      // ftyp box at offset 4 (after the 4-byte box size).
      const isFtyp =
        bytes.byteLength >= 8 &&
        bytes[4] === 0x66 &&
        bytes[5] === 0x74 &&
        bytes[6] === 0x79 &&
        bytes[7] === 0x70;
      if (!isFtyp) throw badSignature(mime, 'MP4 (ftyp box)');
      return { kind, bytes, width: null, height: null };
    }
    case 'video/webm': {
      if (
        !(bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
      ) {
        throw badSignature(mime, 'WebM (EBML header)');
      }
      return { kind, bytes, width: null, height: null };
    }
    case 'audio/mpeg': {
      const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
      const isFrameSync = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
      if (!isId3 && !isFrameSync) throw badSignature(mime, 'MP3 (ID3 or frame sync)');
      return { kind, bytes, width: null, height: null };
    }
    case 'audio/wav':
    case 'audio/x-wav': {
      const isRiff =
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
      const isWave =
        bytes.byteLength >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x41 &&
        bytes[10] === 0x56 &&
        bytes[11] === 0x45;
      if (!isRiff || !isWave) throw badSignature(mime, 'WAV (RIFF/WAVE)');
      return { kind, bytes, width: null, height: null };
    }
    case 'audio/ogg': {
      const isOgg =
        bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
      if (!isOgg) throw badSignature(mime, 'OGG (OggS)');
      return { kind, bytes, width: null, height: null };
    }
    case 'application/pdf': {
      if (
        !(
          bytes[0] === 0x25 &&
          bytes[1] === 0x50 &&
          bytes[2] === 0x44 &&
          bytes[3] === 0x46 &&
          bytes[4] === 0x2d
        )
      ) {
        throw badSignature(mime, 'PDF (%PDF-)');
      }
      return { kind, bytes, width: null, height: null };
    }
    case 'application/zip':
    case 'application/x-zip-compressed': {
      // PK\x03\x04 (file), PK\x05\x06 (empty archive), PK\x07\x08 (spanned).
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]!))) {
        throw badSignature(mime, 'ZIP (PK header)');
      }
      return { kind, bytes, width: null, height: null };
    }
    case 'text/plain':
    case 'text/csv': {
      verifyText(bytes, mime);
      return { kind, bytes, width: null, height: null };
    }
    default:
      throw unsupported(declaredMimeType);
  }
}

/** Folder rules: '' = root; otherwise lowercase slash-separated segments of [a-z0-9-_], max 120 chars, no leading/trailing slash, no '..'. */
export function normalizeFolder(raw: string | undefined | null): string {
  const folder = (raw ?? '').trim().toLowerCase();
  if (folder === '') return '';
  if (folder.length > 120) {
    throw new UnprocessableEntityException(
      'Folder must be at most 120 characters.',
    );
  }
  if (
    folder.startsWith('/') ||
    folder.endsWith('/') ||
    folder.includes('//') ||
    folder.includes('..')
  ) {
    throw new UnprocessableEntityException(
      "Folder must be slash-separated names without leading/trailing slashes or '..'.",
    );
  }
  const bad = folder.split('/').find((seg) => !/^[a-z0-9][a-z0-9_-]*$/.test(seg));
  if (bad !== undefined) {
    throw new UnprocessableEntityException(
      `Folder segment '${bad}' is invalid — use letters, digits, '-' or '_'.`,
    );
  }
  return folder;
}

/** Tags: at most 10, each 1–30 chars of [a-z0-9-_], lowercased, deduplicated. */
export function normalizeTags(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const tags: string[] = [];
  for (const t of list) {
    const tag = String(t).trim().toLowerCase();
    if (tag === '') continue;
    if (tag.length > 30 || !/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
      throw new UnprocessableEntityException(
        `Tag '${tag}' is invalid — 1–30 chars of letters, digits, '-' or '_'.`,
      );
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > 10) {
    throw new UnprocessableEntityException('At most 10 tags per file.');
  }
  return tags;
}

/**
 * Display-name validation for library files (upload + rename): the
 * ORIGINAL filename is kept as-is — spaces included, because it is
 * what the user searches for. Only path separators, control
 * characters and header-breaking quotes are replaced, and leading
 * dots are stripped (no hidden files). The STORAGE key is sanitized
 * separately by `mediaObjectKey` (via `sanitizeFilename`), so the
 * display name never has to be storage-safe.
 */
export function normalizeFilename(raw: string): string {
  const name = raw
    .trim()
    .replace(/[/\\<>:"|?*\x00-\x1F\x7F]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 255)
    .trim();
  if (name === '') {
    throw new UnprocessableEntityException('Filename is required.');
  }
  return name;
}

/** Storage-safe filename segment (for the object key only — the display name keeps spaces). */
export function sanitizeFilename(raw: string): string {
  return raw
    .trim()
    .replace(/[/\\<>:"|?*\x00-\x1F\x7F\s]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

/** Server-generated object key — never user-supplied paths. */
export function mediaObjectKey(filename: string, now = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = randomUUID();
  const safe = sanitizeFilename(filename) || 'file';
  return `media/${yyyy}/${mm}/${id}-${safe}`;
}
