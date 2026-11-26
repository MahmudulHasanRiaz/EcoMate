// Live platform tenant-registry client (Phase 3).
//
// TWO consumers, ONE snapshot (same 60 s cache + last-good semantics as
// the org-limit resolver in src/org-limits.ts):
//   1. `trustedOrigins` (src/auth-options.ts) — an origin is trusted iff
//      its host is in the config allowlist OR in the registry (tenant
//      subdomains + VERIFIED/ACTIVE custom domains). The registry
//      endpoint already filters exactly that way
//      (`GET /internal/tenants/registry` returns per-tenant `hosts`),
//      so this client trusts the endpoint's filtering and does not
//      re-implement domain-type/status logic.
//   2. Impersonation consume (src/impersonation-handoff.ts) — a
//      custom-domain host must be a registered host OF THE ORG being
//      impersonated (per-org lookup, not the global set).
//   3. `baseURL.allowedHosts` sync — BA 1.7.28's DynamicBaseURLConfig
//      takes a STATIC string[] (no function form — see
//      @better-auth/core/dist/types/init-options.d.mts
//      `DynamicBaseURLConfig`). A custom-domain tenant's proxied call
//      arrives with the custom host, and without that host in
//      allowedHosts BA throws BEFORE trustedOrigins ever runs
//      (500 `auth_handler_error`). The registry therefore ALSO syncs
//      its hosts into the shared allowedHosts array, in place.
//      This works because BA keeps the config object by reference and
//      resolves the baseURL per request (dist/context/helpers.mjs
//      `resolveRequestContext` reads `ctx.options.baseURL` on every
//      request; dist/context/create-context.mjs keeps the dynamic
//      config object itself, not a copy). It is a BA-1.7.28-internals
//      dependency: the test `allowedHosts sync` in
//      tests/tenant-registry.test.ts proves the post-boot mutation
//      takes effect, and MUST be re-run (and pass) on any Better Auth
//      upgrade. Only hosts the registry itself added are ever removed
//      again — static entries are never touched.
//
// Degradation (explicit, by design):
//   - Registry NOT configured (no AUTH_PLATFORM_API_URL or no
//     INTERNAL_SERVICE_SECRET): the client is null (see
//     `createTenantRegistry`) and both consumers fall back to Phase 1
//     behaviour — config allowlist for trustedOrigins, the slug check +
//     warning-accept for consume. Production compose always configures
//     both values; the fallback exists for local dev / schema-gen only.
//   - Registry fetch fails: the last-good snapshot keeps serving
//     (a verified custom domain stays usable through a platform-api
//     blip); with no snapshot at all the consumers fail closed
//     (trustedOrigins: not trusted; consume: unregistered_host).
//   - Freshness lag: a newly verified custom domain becomes usable
//     for auth within one refresh interval (60 s) of verification.
//     The registry is also refreshed on a timer (see createServer) so
//     the allowedHosts array converges even with no auth traffic —
//     a lazy-only refresh could never run, because an unlisted host
//     500s at baseURL resolution before trustedOrigins is consulted.
import { logger } from './logger.js';

export const TENANT_REGISTRY_CACHE_TTL_MS = 60_000;
export const TENANT_REGISTRY_FETCH_TIMEOUT_MS = 3000;
export const TENANT_REGISTRY_PATH = '/internal/tenants/registry';

export interface TenantRegistrySnapshot {
  /** All registered tenant hosts (subdomains + verified custom domains). */
  hosts: Set<string>;
  /** Per-tenant hosts, keyed by tenant id (= organization id). */
  tenants: Map<string, Set<string>>;
  fetchedAt: number;
}

/** Lowercase + strip any :port — registry hosts never carry ports. */
export function normalizeRegistryHost(host: string): string {
  return host.trim().toLowerCase().split(':')[0];
}

/**
 * Parse a `GET /internal/tenants/registry` payload into per-tenant host
 * sets. Pure (unit-testable). Unknown shapes yield empty sets, never a
 * throw — a malformed registry must degrade to "nothing registered",
 * not crash the auth service.
 */
export function parseRegistryPayload(
  body: unknown,
): Map<string, Set<string>> {
  const tenants = new Map<string, Set<string>>();
  const list =
    body && typeof body === 'object' && Array.isArray(
      (body as Record<string, unknown>)['tenants'],
    )
      ? ((body as Record<string, unknown>)['tenants'] as unknown[])
      : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = record['id'];
    const hosts = record['hosts'];
    if (typeof id !== 'string' || id.length === 0) continue;
    if (!Array.isArray(hosts)) continue;
    const set = new Set<string>();
    for (const host of hosts) {
      if (typeof host !== 'string' || host.length === 0) continue;
      set.add(normalizeRegistryHost(host));
    }
    tenants.set(id, set);
  }
  return tenants;
}

export interface TenantRegistryOptions {
  platformApiUrl?: string;
  internalSecret?: string | null;
  fetchFn?: typeof fetch;
  /**
   * The shared allowedHosts array (the SAME array reference Better Auth
   * holds via `baseURL.allowedHosts`). When provided, every refresh
   * syncs registry hosts into it in place (see the module header).
   * Omit only in unit contexts where no BA instance exists.
   */
  allowedHosts?: string[];
}

export class TenantRegistry {
  private readonly platformApiUrl: string;
  private readonly internalSecret: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly allowedHosts?: string[];
  private snapshot: TenantRegistrySnapshot | null = null;
  /** Hosts this registry added to the shared allowedHosts array. */
  private syncedHosts = new Set<string>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: TenantRegistryOptions = {}) {
    this.platformApiUrl = (opts.platformApiUrl || '').replace(/\/$/, '');
    this.internalSecret = opts.internalSecret ?? null;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.allowedHosts = opts.allowedHosts;
  }

  get isConfigured(): boolean {
    return this.platformApiUrl.length > 0 && this.internalSecret !== null;
  }

  /**
   * Fetch the registry now and replace the snapshot. Never throws:
   * on any failure the last-good snapshot stands and null is returned
   * when there is none. Also syncs the shared allowedHosts array
   * (when one was provided) — see the module header.
   */
  async refresh(): Promise<TenantRegistrySnapshot | null> {
    if (!this.isConfigured) return this.snapshot;
    try {
      const res = await this.fetchFn(
        `${this.platformApiUrl}${TENANT_REGISTRY_PATH}`,
        {
          headers: {
            'x-platform-service-token': this.internalSecret as string,
          },
          signal: AbortSignal.timeout(TENANT_REGISTRY_FETCH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        logger.warn('auth.tenant_registry.fetch_failed', {
          status: res.status,
        });
        return this.snapshot;
      }
      const body: unknown = await res.json();
      const tenants = parseRegistryPayload(body);
      const hosts = new Set<string>();
      for (const set of tenants.values()) {
        for (const host of set) hosts.add(host);
      }
      this.snapshot = { hosts, tenants, fetchedAt: Date.now() };
      this.syncAllowedHosts();
      return this.snapshot;
    } catch (err) {
      logger.warn('auth.tenant_registry.fetch_error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.snapshot;
    }
  }

  /** Cached snapshot (refreshes when older than the 60 s TTL). */
  async getSnapshot(): Promise<TenantRegistrySnapshot | null> {
    if (
      this.snapshot !== null &&
      Date.now() - this.snapshot.fetchedAt < TENANT_REGISTRY_CACHE_TTL_MS
    ) {
      return this.snapshot;
    }
    return this.refresh();
  }

  /** True iff the host is a registered tenant host (any tenant). */
  async isRegisteredHost(host: string): Promise<boolean> {
    const snapshot = await this.getSnapshot();
    if (!snapshot) return false;
    return snapshot.hosts.has(normalizeRegistryHost(host));
  }

  /**
   * The registered hosts of ONE tenant (organization id), or null when
   * the registry is unavailable or the tenant is not in it. A null
   * return is "unknown", not "no hosts" — callers fail closed on it.
   */
  async getTenantHosts(tenantId: string): Promise<Set<string> | null> {
    const snapshot = await this.getSnapshot();
    if (!snapshot) return null;
    return snapshot.tenants.get(tenantId) ?? null;
  }

  /**
   * Sync registry hosts into the shared allowedHosts array, in place:
   * add hosts the registry newly lists, remove hosts it no longer
   * lists (only ones this registry added — static entries are never
   * touched). No-op when no array was provided or no snapshot exists.
   */
  syncAllowedHosts(): void {
    if (!this.allowedHosts || !this.snapshot) return;
    const next = this.snapshot.hosts;
    for (const host of [...this.syncedHosts]) {
      if (next.has(host)) continue;
      const idx = this.allowedHosts.indexOf(host);
      if (idx !== -1) this.allowedHosts.splice(idx, 1);
      this.syncedHosts.delete(host);
    }
    for (const host of next) {
      if (this.syncedHosts.has(host)) continue;
      if (!this.allowedHosts.includes(host)) {
        this.allowedHosts.push(host);
      }
      this.syncedHosts.add(host);
    }
  }

  /** Background refresh (unref'd — never holds the process open). */
  startAutoRefresh(intervalMs: number = TENANT_REGISTRY_CACHE_TTL_MS): void {
    if (this.refreshTimer || !this.isConfigured) return;
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, intervalMs);
    this.refreshTimer.unref();
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Test-only: drop the cached snapshot + sync tracking, and remove
   * previously synced hosts from the shared allowedHosts array so a
   * later refresh starts from the static entries alone.
   */
  __resetForTests(): void {
    if (this.allowedHosts) {
      for (const host of [...this.syncedHosts]) {
        const idx = this.allowedHosts.indexOf(host);
        if (idx !== -1) this.allowedHosts.splice(idx, 1);
      }
    }
    this.snapshot = null;
    this.syncedHosts = new Set();
  }
}

/**
 * Build the registry for a service config, or null when the platform
 * registry is not reachable from this service (no platform-api URL or
 * no internal secret). Null means "Phase 1 behaviour" for both
 * consumers — it is a deployment configuration state, not an error.
 * `allowedHosts` MUST be the same array reference Better Auth holds
 * (config.allowedHosts — buildAuthOptions passes it through verbatim).
 */
export function createTenantRegistry(
  opts: {
    platformApiUrl?: string;
    internalSecret?: string | null;
    allowedHosts?: string[];
  } = {},
): TenantRegistry | null {
  if (!opts.platformApiUrl || !opts.internalSecret) return null;
  return new TenantRegistry({
    platformApiUrl: opts.platformApiUrl,
    internalSecret: opts.internalSecret,
    allowedHosts: opts.allowedHosts,
  });
}
