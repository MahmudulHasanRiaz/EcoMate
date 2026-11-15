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
const hostCache = new Map<string, { expiresAt: number; allowed: boolean }>();

/** Test/ops hook: forget cached custom/unknown lookups. */
export function clearHostResolutionCache(): void {
  hostCache.clear();
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
 * True/false when the backend registry answered; null when it could not be
 * reached. A 404 must 404 the page; an outage falls open so a healthy
 * storefront keeps serving (SSR itself will fail closed without a tenant).
 */
async function registryAllowsHost(host: string): Promise<boolean | null> {
  // Local/dev has no platform registry; keep the historic single-tenant flow.
  if (process.env.NODE_ENV !== "production") return true;

  const cached = hostCache.get(host);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

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
    const allowed = response.ok;
    if (response.ok || response.status === 404) {
      if (hostCache.size >= HOST_CACHE_MAX) hostCache.clear();
      hostCache.set(host, {
        expiresAt: Date.now() + HOST_CACHE_TTL_MS,
        allowed,
      });
      return allowed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Host is the address the proxy was actually reached on. x-forwarded-host is
  // deliberately NOT used here: it is client-controllable unless the edge
  // overwrites it, and a spoofed value could bounce a visitor to another
  // tenant's canonical host.
  const host = request.headers.get("host") ?? "";
  const config = readDomainConfig();
  const baseResolution = resolveBaseDomainAlias(host, config);
  const exempt = isAliasExempt(pathname);

  if (baseResolution?.isAlias && !exempt) {
    const redirect = aliasRedirectTarget(host, pathname, search, config);
    if (redirect) {
      const response = NextResponse.redirect(redirect, 301);
      // Belt-and-braces with the 301: an alias must never be indexed, even
      // if a crawler records the redirect response itself.
      response.headers.set("X-Robots-Tag", "noindex");
      return response;
    }
  }

  const aliasNoindex = baseResolution?.isAlias === true;

  if (!baseResolution && !exempt) {
    // Platform/base hosts are not storefronts. Serving them here would render
    // an empty tenant shell on www/api/cname and hide a routing mistake.
    if (isBaseOrPlatformHost(host, config)) return notFoundHost();

    const allowed = await registryAllowsHost(normaliseHost(host));
    if (allowed === false) return notFoundHost();
    // null = backend unreachable → serve; SSR fails closed without a tenant.
  }

  // Alias-host responses that are intentionally not redirected (API/proxied
  // assets) still carry noindex so a search engine cannot associate alias
  // content with this tenant.
  const noindex = aliasNoindex;

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

    const requestHeaders = new Headers(request.headers);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("x-is-landing", "true");
    if (noindex) response.headers.set("X-Robots-Tag", "noindex");

    return response;
  }

  const response = NextResponse.next();
  if (noindex) response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

export const config = {
  // Everything except the paths that must keep answering on aliases and
  // Next's own immutable build assets.
  matcher: ["/((?!api|_next|uploads|assets).*)"],
};
