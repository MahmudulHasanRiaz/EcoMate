import { Injectable, Logger, Optional } from '@nestjs/common';
import { isIPv4, isIPv6 } from 'node:net';
import {
  defaultDns,
  resolveAndPin,
  type DnsResolver,
} from '../../images/ip-classifier';
import type { FetchFn, ProbeHttpResponse } from './base-provider';

/**
 * ProviderUrlGuard — Phase 9 §3.7 (NEW: exists neither upstream nor in
 * the baseline). SSRF protection for every outbound provider call:
 * the CUSTOM bridge URL (and the WooCommerce site URL) are
 * tenant-supplied, so without this a malicious tenant could point a
 * "store" at 169.254.169.254, localhost admin ports, or any internal
 * service and have the backend fetch it with its network position.
 *
 * Rules, enforced on EVERY request the guard wraps (including the
 * `testConnection` probes — they go through the same fetchFn seam):
 * - https-only. http is allowed ONLY to a loopback literal AND only
 *   when `STORE_ALLOW_HTTP_LOOPBACK=true` AND `NODE_ENV !== 'production'`
 *   (local dev against a fake bridge; never production).
 * - No embedded credentials in the URL.
 * - The hostname is DNS-resolved and EVERY returned address must be
 *   globally routable (`resolveAndPin` — mixed public+private rejects,
 *   empty DNS rejects, literal private IPs reject).
 * - Redirects are followed MANUALLY (max 5, GET/HEAD only): each hop is
 *   re-validated, https→http downgrades are refused, and a redirect on
 *   a non-GET/HEAD request is returned as-is (never followed — the
 *   adapter treats the 3xx as a failure). The inner fetch is always
 *   called with `redirect: 'manual'` so the platform can never
 *   auto-follow past the guard.
 *
 * RESIDUAL RISK (documented, accepted): the fetch seam takes a URL, not
 * a pinned IP, so the DNS check and the connect are two lookups — a
 * rebinding attack (attacker DNS returning a public IP at check time
 * and a private IP at connect time) is not closed by this guard. The
 * check still blocks the realistic attack (a directly-configured
 * private target). Closing the TOCTOU window would need a custom
 * undici Agent with a pinned lookup — out of scope for the fetchFn
 * seam; revisit if custom-bridge URLs ever become untrusted-input
 * rather than operator-configured.
 */
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isLoopbackLiteral(host: string): boolean {
  if (host === 'localhost') return true;
  let h = host;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (isIPv4(h)) return h.startsWith('127.');
  if (isIPv6(h)) return h === '::1';
  return false;
}

@Injectable()
export class ProviderUrlGuard {
  private readonly logger = new Logger(ProviderUrlGuard.name);

  constructor(
    @Optional() private readonly dns?: DnsResolver,
  ) {}

  /**
   * Wrap a provider fetchFn with SSRF validation + guarded redirects.
   * The wrapped function is a drop-in FetchFn (same signature).
   */
  wrapFetch(fetchFn: FetchFn): FetchFn {
    return async (url, init) => {
      let current = url;
      let currentInit = init;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await this.assertAllowed(current);
        const res = await fetchFn(current, {
          ...currentInit,
          redirect: 'manual',
        } as Parameters<FetchFn>[1]);
        const location = res.headers?.get?.('location') ?? null;
        if (!REDIRECT_STATUSES.has(res.status) || !location) return res;
        const method = (currentInit?.method ?? 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          // Never follow a redirect on a mutating request — return the
          // 3xx and let the adapter fail loudly.
          return res;
        }
        if (hop === MAX_REDIRECTS) {
          throw new Error(
            `Provider URL guard: too many redirects (>${MAX_REDIRECTS}) for ${this.redact(url)}`,
          );
        }
        const next = new URL(location, current);
        if (
          new URL(current).protocol === 'https:' &&
          next.protocol !== 'https:'
        ) {
          throw new Error(
            'Provider URL guard: redirect downgrades https to http — refused',
          );
        }
        current = next.toString();
        // 303 converts the follow-up to GET (spec); 301/302 keep GET/HEAD.
        if (res.status === 303) {
          currentInit = { ...currentInit, method: 'GET', body: undefined };
        }
      }
      throw new Error(
        `Provider URL guard: too many redirects (>${MAX_REDIRECTS}) for ${this.redact(url)}`,
      );
    };
  }

  /** Validate one URL (scheme, credentials, DNS → public IPs only). Throws on any violation. */
  async assertAllowed(rawUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('Provider URL guard: invalid URL');
    }
    if (parsed.username || parsed.password) {
      throw new Error('Provider URL guard: URL must not contain embedded credentials');
    }
    const allowHttpLoopback =
      process.env.STORE_ALLOW_HTTP_LOOPBACK === 'true' &&
      process.env.NODE_ENV !== 'production';
    if (parsed.protocol === 'http:') {
      if (!allowHttpLoopback || !isLoopbackLiteral(parsed.hostname)) {
        throw new Error(
          'Provider URL guard: only https URLs are allowed (http only to loopback with STORE_ALLOW_HTTP_LOOPBACK in non-production)',
        );
      }
      // Loopback http is explicitly allowed by the flag — skip DNS.
      return;
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('Provider URL guard: only https URLs are allowed');
    }
    // Literal IP hosts: resolveAndPin validates directly (no DNS).
    // Hostnames: every resolved address must be globally routable.
    try {
      await resolveAndPin(parsed.hostname, this.dns ?? defaultDns);
    } catch (err) {
      throw new Error(
        `Provider URL guard: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private redact(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    } catch {
      return '(unparseable url)';
    }
  }
}
