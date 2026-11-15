import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";

// On-demand, TENANT-SCOPED cache invalidation (Speed Plan P4 + Phase 4.5).
//
// Next's Data Cache is keyed by URL only, so a shared storefront would leak
// one tenant's cached page/data to another host. Every serverFetch therefore
// tags entries as `t:<tenantId>:<tag>`, and this endpoint invalidates only the
// tags belonging to the tenant in the request:
//
//   curl -X POST https://<tenant-host>/api/revalidate \
//     -H "x-revalidation-secret: $REVALIDATION_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"tenantId":"<uuid>","tags":["products","config"]}'
//
// `tenantId` is REQUIRED and must be a UUID. Tags may be base names
// (products/config) or already-scoped `t:<uuid>:<name>` values; a scoped tag
// for a different tenant is ignored, so this endpoint cannot purge another
// host's cache even with a leaked secret.
//
// The shared secret comes from REVALIDATION_SECRET (server-only). When unset
// the endpoint is DISABLED (401). The CDN edge cache is not purged here.
export const dynamic = "force-dynamic";

const ALLOWED_TAGS = ["products", "config"] as const;
const TENANT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function providedSecret(request: Request): string | null {
  const headerSecret = request.headers.get("x-revalidation-secret");
  if (headerSecret) return headerSecret;
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return null;
}

async function parseRequest(
  request: Request,
): Promise<{ tags: string[]; tenantId: string | null }> {
  const tags = new Set<string>();
  const url = new URL(request.url);
  let tenantId =
    url.searchParams.get("tenantId") ?? url.searchParams.get("tenant");
  for (const tag of url.searchParams.getAll("tag")) tags.add(tag);
  for (const tag of url.searchParams.get("tags")?.split(",") ?? []) {
    if (tag.trim()) tags.add(tag.trim());
  }
  try {
    const body = (await request.json()) as {
      tags?: unknown;
      tag?: unknown;
      tenantId?: unknown;
      tenant?: unknown;
    };
    if (
      typeof body?.tenantId === "string" &&
      body.tenantId.trim()
    ) {
      tenantId = body.tenantId;
    } else if (typeof body?.tenant === "string" && body.tenant.trim()) {
      tenantId = body.tenant;
    }
    const bodyTags = [
      ...(Array.isArray(body?.tags) ? body.tags : []),
      ...(typeof body?.tag === "string" ? [body.tag] : []),
    ];
    for (const tag of bodyTags) {
      if (typeof tag === "string" && tag.trim()) tags.add(tag.trim());
    }
  } catch {
    // No/invalid JSON body — query params alone are a valid call shape.
  }
  return {
    tags: [...tags],
    tenantId: tenantId?.trim() || null,
  };
}

/**
 * Map an input tag to its tenant-scoped form. A tag already scoped to another
 * tenant is rejected (null) instead of being re-scoped.
 */
function scopeTag(tag: string, tenantId: string): string | null {
  const scoped = /^t:([^:]+):(.+)$/.exec(tag);
  if (scoped) {
    if (scoped[1].toLowerCase() !== tenantId.toLowerCase()) return null;
    return (ALLOWED_TAGS as readonly string[]).includes(scoped[2])
      ? `t:${tenantId}:${scoped[2]}`
      : null;
  }
  return (ALLOWED_TAGS as readonly string[]).includes(tag)
    ? `t:${tenantId}:${tag}`
    : null;
}

export async function POST(request: Request) {
  const secret = process.env.REVALIDATION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { revalidated: false, message: "Revalidation is not configured" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (!secretMatches(providedSecret(request), secret)) {
    return NextResponse.json(
      { revalidated: false, message: "Invalid or missing secret" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { tags, tenantId } = await parseRequest(request);
  if (!tenantId || !TENANT_ID_RE.test(tenantId)) {
    return NextResponse.json(
      {
        revalidated: false,
        message: "A valid tenantId (UUID) is required",
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const scoped = [
    ...new Set(
      tags
        .map((tag) => scopeTag(tag, tenantId))
        .filter((tag): tag is string => tag !== null),
    ),
  ];
  if (scoped.length === 0) {
    return NextResponse.json(
      {
        revalidated: false,
        message: `No valid tag supplied. Allowed tags: ${ALLOWED_TAGS.join(", ")}`,
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  for (const tag of scoped) {
    // External caller (webhook pattern): expire immediately instead of
    // serving stale-while-revalidate, so an edit is visible on the next
    // request.
    revalidateTag(tag, { expire: 0 });
  }

  return NextResponse.json(
    { revalidated: true, tenantId, tags: scoped, now: Date.now() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
