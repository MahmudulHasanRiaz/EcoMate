import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { aliasRedirectTarget, resolveBaseDomainAlias } from "./lib/tenant-host";

// Paths that must keep answering on alias hosts instead of redirecting:
// API clients and integration webhooks rely on the alias staying usable.
const ALIAS_EXEMPT_PREFIXES = ["/api", "/_next", "/uploads", "/assets"];

function isAliasExempt(pathname: string): boolean {
  return ALIAS_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Host is the address the proxy was actually reached on. x-forwarded-host is
  // deliberately NOT used here: it is client-controllable unless the edge
  // overwrites it, and a spoofed value could bounce a visitor to another
  // tenant's canonical host.
  const host = request.headers.get("host") ?? "";

  if (!isAliasExempt(pathname)) {
    const redirect = aliasRedirectTarget(host, pathname, search);
    if (redirect) {
      const response = NextResponse.redirect(redirect, 301);
      // Belt-and-braces with the 301: an alias must never be indexed, even
      // if a crawler records the redirect response itself.
      response.headers.set("X-Robots-Tag", "noindex");
      return response;
    }
  }

  // Alias-host responses that are intentionally not redirected (API/proxied
  // assets) still carry noindex so a search engine cannot associate alias
  // content with this tenant.
  const alias = resolveBaseDomainAlias(host);
  const noindex = alias?.isAlias === true;

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
