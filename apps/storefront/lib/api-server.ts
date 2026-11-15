import { headers } from "next/headers";

const API = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

/**
 * The backend resolves the tenant from the request Host. Server-side fetches
 * originate from the storefront container (backend:4000), so the tenant host
 * must be forwarded explicitly. This override is trusted by the backend only
 * together with the internal shared secret from a private peer — never from a
 * browser.
 *
 * The proxy also injects x-tenant-id / x-tenant-slug for Next cache-tag
 * namespacing (t:<tenantId>:products). Outside a request scope (build-time
 * static generation, scripts) `headers()` throws; there is no tenant, so the
 * tags fall back to the unresolved namespace.
 */
async function requestTenantContext(): Promise<{
  host?: string;
  tenantId?: string;
  slug?: string;
}> {
  try {
    const requestHeaders = await headers();
    return {
      host: requestHeaders.get("x-tenant-host") || requestHeaders.get("host") || undefined,
      tenantId: requestHeaders.get("x-tenant-id") || undefined,
      slug: requestHeaders.get("x-tenant-slug") || undefined,
    };
  } catch {
    return {};
  }
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  if (err instanceof TypeError) {
    const cause = (err as any).cause;
    if (cause?.code === 'ECONNREFUSED') return true;
    if (cause?.name === 'AggregateError' && Array.isArray(cause.errors)) {
      return cause.errors.some((e: any) => e?.code === 'ECONNREFUSED');
    }
    return true;
  }
  return false;
}

export async function serverFetch<T = unknown>(
  path: string,
  options?: RequestInit & {
    revalidate?: number;
    // Cache tags for on-demand revalidation (`POST /api/revalidate`,
    // Speed Plan P4). Merged with any `next` option the caller passes.
    tags?: string[];
    timeout?: number;
    maxRetries?: number;
  }
): Promise<T> {
  const { revalidate, tags, timeout: customTimeout, maxRetries: customMaxRetries, ...fetchOptions } = options || {};
  const MAX_RETRIES = customMaxRetries ?? 3;
  const BASE_DELAY = 500;
  const TIMEOUT = customTimeout || 15000;

  // Merge the Next fetch-cache options from every supported spelling:
  // the convenience top-level `revalidate`/`tags` and a caller's own
  // `next: { revalidate, tags }` (which previously just rode along in
  // fetchOptions and won by spread order). Explicit top-level values win.
  const { next: callerNext, headers: callerHeaders, ...restFetchOptions } = fetchOptions as RequestInit & {
    next?: { revalidate?: number | false; tags?: string[] };
  };

  const tenantContext = await requestTenantContext();
  // Every Data Cache entry is namespaced by tenant. Without a resolved id
  // (build-time render, registry outage) the host/slug or a stable
  // "unresolved" namespace keeps cross-tenant entries apart.
  const tenantScope =
    tenantContext.tenantId || tenantContext.slug || "unresolved";
  const requestedTags = tags ?? callerNext?.tags;
  const scopedTags = requestedTags?.map((tag) =>
    tag.startsWith("t:") ? tag : `t:${tenantScope}:${tag}`,
  );

  const nextOptions = {
    ...callerNext,
    ...(revalidate !== undefined ? { revalidate } : {}),
    ...(scopedTags ? { tags: scopedTags } : {}),
  };
  const hasNextOptions = Object.keys(nextOptions).length > 0;

  // F2: server-to-server calls identify themselves with the shared internal
  // secret (server-only env — never NEXT_PUBLIC_, never sent from the
  // browser). The backend exempts these from rate limiting only when the TCP
  // peer is also a private address (F1). The tenant host rides the same
  // trusted channel so RLS resolves the right tenant.
  const internalSecret = process.env.INTERNAL_SHARED_SECRET;
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(internalSecret ? { "x-internal-secret": internalSecret } : {}),
    ...(tenantContext.host ? { "x-tenant-host": tenantContext.host } : {}),
  };
  const mergedHeaders = {
    ...requestHeaders,
    ...((callerHeaders as Record<string, string> | undefined) ?? {}),
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const res = await fetch(`${API}${path}`, {
        headers: mergedHeaders,
        ...(hasNextOptions ? { next: nextOptions } : {}),
        signal: controller.signal,
        ...restFetchOptions,
      });
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null as unknown as T;
    } catch (err) {
      lastError = err;
      clearTimeout(timeout);
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        const delay = BASE_DELAY * Math.pow(2, attempt);
        console.warn(`[serverFetch] Retry ${attempt + 1}/${MAX_RETRIES} for ${path} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error(`serverFetch exhausted retries for ${path}`);
}
