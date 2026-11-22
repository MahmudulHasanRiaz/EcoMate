import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

/**
 * Cache purge (Batch 1, item 3): POST /api/revalidate invalidates the
 * cached managed content, branding, landing settings, and public plans
 * so a console edit reaches the landing immediately instead of waiting
 * for the 5-minute TTL.
 *
 * Guarded by the shared INTERNAL_SERVICE_SECRET (the same secret the
 * platform API uses for backend calls) via the x-internal-secret
 * header. The secret never reaches the browser: the console calls
 * platform-api POST /landing-cache/purge, which calls this route
 * server-to-server. A wrong secret, a missing secret in env, or an
 * unknown tag all fail closed.
 */
const PURGEABLE_TAGS = [
  'landing-content',
  'branding',
  'landing-settings',
  'public-plans',
  'case-studies',
  // Blog (Batch 2, item 20): public blog reads are tagged 'blog'
  // (lib/blog.ts) — without this, a purge leaves published posts
  // stale for the full 5-minute TTL.
  'blog',
  // Client reviews (shared media model): public review reads are
  // tagged 'client-reviews' (lib/client-reviews.ts).
  'client-reviews',
] as const;

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.INTERNAL_SERVICE_SECRET ?? '';
  if (!expected) {
    return NextResponse.json(
      { error: 'revalidate_not_configured' },
      { status: 503 },
    );
  }
  if (!secretMatches(request.headers.get('x-internal-secret'), expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let tag: string | undefined;
  try {
    const body: unknown = await request.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { tag?: unknown }).tag === 'string'
    ) {
      tag = (body as { tag: string }).tag;
    }
  } catch {
    // No body / invalid JSON = purge everything.
  }
  const tags = tag
    ? (PURGEABLE_TAGS as readonly string[]).includes(tag)
      ? [tag]
      : null
    : [...PURGEABLE_TAGS];
  if (!tags) {
    return NextResponse.json({ error: 'unknown_tag' }, { status: 400 });
  }
  // { expire: 0 } = purge now; the next fetch revalidates, then the
  // normal 5-minute cache applies again (same pattern as the
  // storefront's revalidate route). The home page and the indexing
  // pages are static, so revalidate their paths too.
  for (const t of tags) revalidateTag(t, { expire: 0 });
  revalidatePath('/', 'page');
  revalidatePath('/robots.txt', 'page');
  revalidatePath('/sitemap.xml', 'page');
  return NextResponse.json({ revalidated: tags });
}
