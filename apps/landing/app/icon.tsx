/**
 * Dynamic favicon (Batch 1, item 1): serves the operator-managed
 * favicon from GET /public/branding when one is set (a data:image/*
 * upload decoded inline, or an https URL fetched and proxied), and
 * falls back to the built-in SVG bytes otherwise. Replaces the static
 * app/icon.svg (deleted) — the browser's /favicon.ico and /icon.*
 * requests all resolve to this route.
 */
import { fetchBranding } from '@/lib/branding';

const BUILT_IN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#15803d"/>
  <text x="32" y="45" font-family="system-ui, sans-serif" font-size="38" font-weight="700" fill="#ffffff" text-anchor="middle">E</text>
</svg>
`;

function builtInIcon(): Response {
  return new Response(BUILT_IN_ICON, {
    headers: { 'Content-Type': 'image/svg+xml' },
  });
}

export const dynamic = 'force-dynamic';

export default async function Icon() {
  const { faviconUrl } = await fetchBranding();
  if (!faviconUrl) return builtInIcon();

  // Data URL (console upload): decode the base64 payload inline.
  const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(faviconUrl);
  if (dataMatch) {
    try {
      const bytes = Buffer.from(
        faviconUrl.slice(dataMatch[0].length),
        'base64',
      );
      if (bytes.length === 0) return builtInIcon();
      return new Response(bytes as unknown as BodyInit, {
        headers: { 'Content-Type': dataMatch[1] },
      });
    } catch {
      return builtInIcon();
    }
  }

  // Same-origin path or https URL: fetch and proxy the bytes (the
  // branding fetch already validated the URL is https or same-origin).
  if (faviconUrl.startsWith('/')) {
    // A same-origin path would recurse into this app; the favicon is
    // operator-managed, so only absolute https URLs are proxied.
    return builtInIcon();
  }
  try {
    const response = await fetch(faviconUrl, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return builtInIcon();
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return builtInIcon();
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) return builtInIcon();
    return new Response(bytes, {
      headers: { 'Content-Type': contentType },
    });
  } catch {
    return builtInIcon();
  }
}
