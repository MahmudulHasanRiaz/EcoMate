/**
 * Branding image URLs (logo + favicon, F11). Two forms are accepted:
 *
 * 1. An http(s) URL (the original form), or
 * 2. A `data:image/*;base64,…` URL — how the console stores an UPLOADED
 *    logo/favicon without any new storage infrastructure: the file is
 *    read client-side (FileReader) and saved into the branding JSON row.
 *    Data URLs are only ever used as <img> src / <link rel="icon"> href
 *    (image contexts — an SVG's scripts never execute there).
 *
 * The 300_000-character cap bounds the stored JSON row (~200KB of image
 * bytes after base64 expansion). The console enforces a file-size cap
 * before upload; this is the server-side backstop.
 */
export const BRANDING_IMAGE_MAX_LENGTH = 300_000;

export const BRANDING_IMAGE_URL_PATTERN =
  /^(https?:\/\/\S+|data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2})$/;

export function isBrandingImageUrl(value: string): boolean {
  return (
    value.length <= BRANDING_IMAGE_MAX_LENGTH &&
    BRANDING_IMAGE_URL_PATTERN.test(value)
  );
}
