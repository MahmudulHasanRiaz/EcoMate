/**
 * Contact-endpoint builders for the dock/FAB widget.
 *
 * CMS values are free text, so every builder is defensive: blank or
 * unparseable values resolve to `null` and the caller hides that action
 * instead of rendering a dead link.
 */

/** Bare digits become a `wa.me` link; absolute URLs pass through. */
export function buildWhatsAppUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, '');
  return /^\d{6,20}$/.test(digits) ? `https://wa.me/${digits}` : null;
}

/** Phone numbers become `tel:` links; existing `tel:` values pass through. */
export function buildTelUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^tel:/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^0-9+]/g, '');
  return digits.length > 0 ? `tel:${digits}` : null;
}

/** Absolute http(s) URLs pass through; anything else is hidden. */
export function buildHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(trimmed) ? trimmed : null;
}

/** Extract the 11-char YouTube id from watch/embed/shorts/youtu.be URLs. */
export function youtubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  const match =
    trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/) ??
    trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ??
    trimmed.match(/\/embed\/([A-Za-z0-9_-]{11})/) ??
    trimmed.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
  return match?.[1] ?? null;
}

/** Privacy-enhanced embed URL for a CMS YouTube link. Null when unset/unparseable. */
export function youtubeEmbedUrl(raw: string): string | null {
  const id = youtubeVideoId(raw);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
}
