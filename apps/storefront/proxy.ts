import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  aliasRedirectTarget,
  isBaseOrPlatformHost,
  normaliseHost,
  readDomainConfig,
  resolveBaseDomainAlias,
} from "./lib/tenant-host";

// Paths that must keep answering on alias hosts instead of redirecting:
// API clients and integration webhooks rely on the alias staying usable.
const ALIAS_EXEMPT_PREFIXES = ["/api", "/_next", "/uploads", "/assets"];

// How long a host→tenant verdict is cached at the edge. Custom-domain changes
// (verify/remove) are rare; the platform registry itself refreshes at 60s.
const HOST_CACHE_TTL_MS = 60_000;
const HOST_CACHE_MAX = 1_000;

interface TenantResolvePayload {
  tenantId: string;
  slug: string;
  canonicalHost?: string;
  isAlias?: boolean;
}

interface HostCacheEntry {
  expiresAt: number;
  /** null = the registry explicitly said this host has no tenant. */
  result: TenantResolvePayload | null;
}

const hostCache = new Map<string, HostCacheEntry>();

/** Test/ops hook: forget cached custom/unknown/base lookups. */
export function clearHostResolutionCache(): void {
  hostCache.clear();
}

/**
 * Cache a host→tenant verdict, evicting instead of clearing when full.
 *
 * A burst of distinct custom hosts used to hit the 1,000-entry cap and
 * `clear()` the entire cache — collapsing every cached verdict at once and
 * re-flooding `/tenants/resolve` (thundering herd). Now expired entries go
 * first; if the cache is still full, only the oldest-inserted entry is
 * evicted. Map insertion order is the eviction order.
 */
function cacheHostResolution(
  host: string,
  result: TenantResolvePayload | null,
): void {
  if (!hostCache.has(host) && hostCache.size >= HOST_CACHE_MAX) {
    const now = Date.now();
    for (const [key, entry] of hostCache) {
      if (entry.expiresAt <= now) hostCache.delete(key);
    }
    if (hostCache.size >= HOST_CACHE_MAX) {
      const oldest = hostCache.keys().next().value;
      if (oldest !== undefined) hostCache.delete(oldest);
    }
  }
  hostCache.set(host, {
    expiresAt: Date.now() + HOST_CACHE_TTL_MS,
    result,
  });
}

function isAliasExempt(pathname: string): boolean {
  return ALIAS_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function notFoundHost(): NextResponse {
  return new NextResponse("Unknown host", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, s-maxage=60",
    },
  });
}

/**
 * Ask the backend registry for the tenant behind a host. The result is cached
 * for 60s because the storefront reads it on every SSR request only to stamp
 * tenant-scoped cache tags.
 *
 * `answered` distinguishes "the registry said no" (404 → deny) from "the
 * registry could not be reached" (fail open; SSR itself fails closed without a
 * tenant context).
 */
async function lookupTenantHost(
  host: string,
): Promise<{ answered: boolean; result: TenantResolvePayload | null }> {
  // Local/dev has no platform registry; SSR falls back to the host-scoped tag
  // namespace and the historic single-tenant flow.
  if (process.env.NODE_ENV !== "production") {
    return { answered: false, result: null };
  }

  const cached = hostCache.get(host);
  if (cached && cached.expiresAt > Date.now()) {
    return { answered: true, result: cached.result };
  }

  const api = (
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:4000/api"
  ).replace(/\/+$/, "");
  const secret = process.env.INTERNAL_SHARED_SECRET;

  try {
    const response = await fetch(
      `${api}/tenants/resolve?host=${encodeURIComponent(host)}`,
      {
        headers: secret ? { "x-internal-secret": secret } : {},
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      },
    );

    if (response.status === 404) {
      cacheHostResolution(host, null);
      return { answered: true, result: null };
    }

    if (!response.ok) return { answered: false, result: null };

    const body = (await response.json().catch(() => null)) as
      | TenantResolvePayload
      | null;
    if (!body || typeof body.tenantId !== "string" || !body.tenantId) {
      return { answered: false, result: null };
    }

    const result: TenantResolvePayload = {
      tenantId: body.tenantId,
      slug: typeof body.slug === "string" ? body.slug : "",
      canonicalHost: body.canonicalHost,
      isAlias: body.isAlias,
    };
    cacheHostResolution(host, result);
    return { answered: true, result };
  } catch {
    return { answered: false, result: null };
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Host is the address the proxy was actually reached on. x-forwarded-host is
  // deliberately NOT used here: it is client-controllable unless the edge
  // overwrites it, and a spoofed value could bounce a visitor to another
  // tenant's canonical host.
  const host = request.headers.get("host") ?? "";
  const normalisedHost = normaliseHost(host);
  const config = readDomainConfig();
  const baseResolution = resolveBaseDomainAlias(host, config);
  const exempt = isAliasExempt(pathname);

  if (baseResolution?.isAlias && !exempt) {
    const redirect = aliasRedirectTarget(host, pathname, search, config, {
      protocol: request.nextUrl.protocol,
      port: request.nextUrl.port,
    });
    if (redirect) {
      const response = NextResponse.redirect(redirect, 301);
      // Belt-and-braces with the 301: an alias must never be indexed, even
      // if a crawler records the redirect response itself.
      response.headers.set("X-Robots-Tag", "noindex");
      return response;
    }
  }

  let resolved: TenantResolvePayload | null = null;

  if (!exempt) {
    if (!baseResolution) {
      // Platform/base hosts are not storefronts. Serving them here would render
      // an empty tenant shell on www/api/cname and hide a routing mistake.
      if (isBaseOrPlatformHost(host, config)) return notFoundHost();

      const lookup = await lookupTenantHost(normalisedHost);
      resolved = lookup.result;
      if (lookup.answered && !resolved) return notFoundHost();
    } else if (process.env.NODE_ENV === "production") {
      // Base-domain hosts resolve locally; the registry lookup only supplies
      // the tenant id for cache tags. A stale registry must not 404 a valid
      // base host, so a 404 here is ignored.
      resolved = (await lookupTenantHost(normalisedHost)).result;
    }
  }

  const aliasNoindex = baseResolution?.isAlias === true;

  // Inject the resolved tenant identity for SSR. serverFetch uses it to
  // namespace Next cache tags (t:<tenantId>:products/config) and forwards
  // x-tenant-host to the backend, which trusts the override only with the
  // internal secret.
  const requestHeaders = new Headers(request.headers);
  if (normalisedHost) requestHeaders.set("x-tenant-host", normalisedHost);
  if (resolved?.tenantId) requestHeaders.set("x-tenant-id", resolved.tenantId);
  const slug = resolved?.slug || baseResolution?.slug;
  if (slug) requestHeaders.set("x-tenant-slug", slug);

  // /api/* requests are rewritten to the backend by next.config
  // (standalone storefronts without Caddy path-routing, incl. the local
  // harness). The rewrite replaces Host with the backend origin, so the
  // backend cannot resolve the tenant from it — it must trust the
  // x-tenant-host override, which it only does together with the internal
  // secret from a private peer. Without this, every tenant API call
  // through the rewrite 403s ("Tenant context is required"). The secret
  // is set here, server-side, by the middleware: the browser never sees
  // it, and it only travels storefront → backend over the private
  // network — the same trust model as serverFetch. (In production Caddy
  // routes /api/* to the backend before the storefront, so the rewrite
  // path is inert there.) Side effect: rewritten browser calls count as
  // internal and are exempt from the backend's adaptive rate limiter,
  // exactly like SSR fetches.
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const secret = process.env.INTERNAL_SHARED_SECRET;
    if (secret) requestHeaders.set("x-internal-secret", secret);
  }

  // Apply strict CSP only to landing pages.
  // NOTE — CSP is defense-in-depth here, DOMPurify is the control: the
  // platform's own SDK is an inline script, so script-src must keep
  // 'unsafe-inline' — and 'unsafe-inline' alone cannot stop user JS once
  // the HTML is sanitized, because DOMPurify strips every event-handler
  // attribute, javascript: URL, iframe and script on every render (see
  // lib/landing-sanitize.ts). 'unsafe-eval' and the Tailwind CDN are
  // dropped: nothing legitimate needs them once user JS is stripped and
  // Tailwind classes from custom HTML never compile (no CDN is loaded).
  if (pathname.startsWith("/landing/")) {
    const isDev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.tailwindcss.com https://fonts.cdnfonts.com",
      "img-src 'self' data: blob: https: http:",
      "font-src 'self' https://fonts.gstatic.com https://fonts.cdnfonts.com",
      `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("x-is-landing", "true");
    if (aliasNoindex) response.headers.set("X-Robots-Tag", "noindex");

    return response;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (aliasNoindex) response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

export const config = {
  // Everything except Next's own immutable build assets. /api IS included
  // on purpose: the proxy injects x-tenant-host + the internal secret for
  // /api/* requests, which the next.config rewrite needs to carry the
  // tenant to the backend (the rewrite replaces Host with the backend
  // origin). /api stays alias-exempt — no redirect, no registry lookup,
  // no 404 — via ALIAS_EXEMPT_PREFIXES, so including it here only adds
  // the header injection, not host gating.
  matcher: ["/((?!_next|uploads|assets).*)"],
};
