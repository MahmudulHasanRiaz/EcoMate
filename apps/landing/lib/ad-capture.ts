/**
 * Ad attribution capture for the lead form (CMS batch 2, item 21).
 *
 * The form sends what the browser has — nothing is loaded for this:
 * no Meta Pixel, no TikTok pixel. When a visitor arrives with Meta
 * cookies (_fbp/_fbc, set by a Meta Pixel on another page or by an
 * earlier visit) or a ttclid in the URL, the values ride along with
 * the lead so the platform's ad dispatch (Meta CAPI / TikTok Events
 * API) can attribute the conversion. Each submission also gets fresh
 * UUID dedup ids (one per platform) so a retried submit never
 * double-counts server-side.
 *
 * Pure functions (no DOM access) so they are unit-testable; the form
 * passes window.location.search / document.cookie in.
 */

export interface AdCapture {
  fbp?: string;
  fbc?: string;
  /** Meta dedup id — fresh UUID per submission. */
  eventId: string;
  ttclid?: string;
  /** TikTok dedup id — fresh UUID per submission. */
  tiktokEventId: string;
}

/** Read one cookie value from a `document.cookie` string. */
export function readCookieValue(
  cookieHeader: string,
  name: string,
): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    const value = trimmed.slice(name.length + 1).trim();
    return value ? decodeURIComponentSafe(value) : undefined;
  }
  return undefined;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A UUID for dedup ids (crypto.randomUUID with a Math.random fallback). */
export function newAdEventId(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined'
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  // Fallback for non-secure contexts (http on old browsers): a
  // UUID-shaped random string — uniqueness, not cryptography, is what
  // a dedup id needs.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Collect the attribution fields for one lead submission. `search` is
 * window.location.search; `cookieHeader` is document.cookie. Empty =
 * not attributed (the common case — no pixels run on the landing).
 */
export function collectAdCapture(
  search: string,
  cookieHeader: string,
): AdCapture {
  const params = new URLSearchParams(search);
  const ttclid = params.get('ttclid') ?? undefined;
  return {
    fbp: readCookieValue(cookieHeader, '_fbp'),
    fbc: readCookieValue(cookieHeader, '_fbc'),
    eventId: newAdEventId(),
    ttclid: ttclid || undefined,
    tiktokEventId: newAdEventId(),
  };
}
