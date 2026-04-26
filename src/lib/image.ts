import { PlaceHolderImages } from '@/lib/placeholder-images';

export const DEFAULT_IMAGE_PLACEHOLDER =
  PlaceHolderImages.find(p => p.id === '1')?.imageUrl || '/placeholder.svg';

function isRenderableUrl(value: string): boolean {
  if (!value) return false;
  if (value.startsWith('/')) return true;
  return value.startsWith('http://') || value.startsWith('https://');
}

function normalizeRelativePath(value: string): string {
  if (!value) return DEFAULT_IMAGE_PLACEHOLDER;
  if (isRenderableUrl(value)) return value;
  return `/${value.replace(/^\/+/, '')}`;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pickUrlFromObject(value: Record<string, unknown>): unknown {
  return (
    value.imageUrl ||
    value.url ||
    value.src ||
    value.href ||
    // sometimes nested like { image: {...} }
    value.image
  );
}

/**
 * Resolve a product/order image field into a safe URL for next/image.
 *
 * Handles:
 * - plain string URLs/paths
 * - stringified JSON arrays/objects (legacy)
 * - nested objects containing `imageUrl`/`url` (including when those are JSON strings)
 * - arrays of images
 */
export function resolveImageSrc(input: unknown, placeholder = DEFAULT_IMAGE_PLACEHOLDER, depth = 0): string {
  if (depth > 5) return placeholder;
  if (!input) return placeholder;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined' || trimmed === '[]' || trimmed === '{}') return placeholder;

    // Detect JSON (starts with [, { or escaped variants)
    if (trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.includes('{"') || trimmed.includes('[{"')) {
      const parsed = tryParseJson(trimmed);
      if (parsed !== null && typeof parsed !== 'string') {
        return resolveImageSrc(parsed, placeholder, depth + 1);
      }
    }

    // If it's a plain URL or path
    if (isRenderableUrl(trimmed)) return trimmed;

    // Check if it's a relative path
    return normalizeRelativePath(trimmed);
  }

  if (Array.isArray(input)) {
    if (input.length === 0) return placeholder;
    return resolveImageSrc(input[0], placeholder, depth + 1);
  }

  if (typeof input === 'object' && input !== null) {
    const picked = pickUrlFromObject(input as Record<string, unknown>);
    if (picked) return resolveImageSrc(picked, placeholder, depth + 1);

    // Last resort: if the object itself has a toString that looks like a URL (unlikely but safe)
    return placeholder;
  }

  return placeholder;
}
