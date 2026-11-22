import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import {
  BindingResolution,
  PlatformBindingClient,
} from './platform-binding.client';

/**
 * ExternalStoreResolver — Phase 9 §3.3. Resolves an external store to
 * its tenant BEFORE any tenant-DB query exists: webhook intake, the
 * Shopify install landing and the bridge contact-check all run without
 * a tenant context, so the tenant MUST come from here (or nowhere).
 *
 * Order: Redis (`extstore:*`, global keys — see CacheService.getGlobal)
 * first, then the platform binding endpoint. The cache is a latency
 * optimisation, never the authority: a stale entry can only delay a
 * disconnect by the TTL, because intake re-checks the tenant Store row
 * status inside the tenant context (DISCONNECTED → 401 there too).
 *
 * Fail-closed: platform outage + cache miss → null (the caller answers
 * the generic 401). NEVER fall back to a global Prisma query — there is
 * no tenant-safe way to ask "which tenant owns this store" from the
 * tenant DB, and a global query would bypass RLS by construction.
 *
 * Status semantics (platform §3.4): PENDING and ACTIVE resolve;
 * DISCONNECTED and BLOCKED do not (null). Unknown/unbound/disabled/
 * NATIVE/disconnected are indistinguishable to the caller — the same
 * generic 401, no oracle.
 */

/** Positive cache TTL — a disconnect takes at most this long to stop resolving (intake re-checks the row anyway). */
export const EXTSTORE_CACHE_TTL_MS = 5 * 60_000;
/** Negative cache TTL — an unknown storeId is re-checked after a minute (a just-claimed store must start resolving fast). */
export const EXTSTORE_NEGATIVE_CACHE_TTL_MS = 60_000;

type CachedBinding = BindingResolution | { missing: true };

const isMissing = (v: CachedBinding): v is { missing: true } =>
  (v as { missing?: boolean }).missing === true;

@Injectable()
export class ExternalStoreResolver {
  private readonly logger = new Logger(ExternalStoreResolver.name);

  constructor(
    private readonly cache: CacheService,
    private readonly platform: PlatformBindingClient,
  ) {}

  /** Resolve a store UUID (webhook `:storeKey`, bridge `storeId`) to its tenant. */
  async resolveStore(storeId: string): Promise<BindingResolution | null> {
    if (!storeId) return null;
    const key = `extstore:${storeId}`;
    const cached = await this.cache.getGlobal<CachedBinding>(key);
    if (cached !== undefined) {
      if (isMissing(cached)) return null;
      return this.usable(cached);
    }
    let resolved: BindingResolution | null;
    try {
      resolved = await this.platform.resolveByStoreId(storeId);
    } catch (err) {
      // Platform outage + cache miss → fail closed (null → generic 401).
      this.logger.warn(
        `external-store resolve failed for ${storeId.slice(0, 8)}… (fail-closed): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    await this.cache.setGlobal(
      key,
      resolved ?? { missing: true },
      resolved ? EXTSTORE_CACHE_TTL_MS : EXTSTORE_NEGATIVE_CACHE_TTL_MS,
    );
    return resolved ? this.usable(resolved) : null;
  }

  /** Resolve a shop domain (Shopify install landing) to its tenant. */
  async resolveDomain(
    provider: 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM',
    domain: string,
  ): Promise<BindingResolution | null> {
    const normalised = domain.trim().toLowerCase();
    if (!normalised) return null;
    const key = `extstore:domain:${provider}:${normalised}`;
    const cached = await this.cache.getGlobal<CachedBinding>(key);
    if (cached !== undefined) {
      if (isMissing(cached)) return null;
      return this.usable(cached);
    }
    let resolved: BindingResolution | null;
    try {
      resolved = await this.platform.resolveByProviderDomain(provider, normalised);
    } catch (err) {
      this.logger.warn(
        `external-store domain resolve failed for ${provider}:${normalised} (fail-closed): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    await this.cache.setGlobal(
      key,
      resolved ?? { missing: true },
      resolved ? EXTSTORE_CACHE_TTL_MS : EXTSTORE_NEGATIVE_CACHE_TTL_MS,
    );
    return resolved ? this.usable(resolved) : null;
  }

  /**
   * Warm the cache after a successful connect (claim + tenant insert):
   * the store's first webhook resolves without a platform round-trip.
   * Best-effort — a cache failure never breaks the connect flow.
   */
  async cacheBinding(
    storeId: string,
    tenantId: string,
    opts?: { provider?: 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM'; domain?: string },
  ): Promise<void> {
    try {
      const value: BindingResolution = { tenantId, status: 'ACTIVE' };
      await this.cache.setGlobal(`extstore:${storeId}`, value, EXTSTORE_CACHE_TTL_MS);
      const domain = opts?.domain?.trim().toLowerCase();
      if (opts?.provider && domain) {
        await this.cache.setGlobal(
          `extstore:domain:${opts.provider}:${domain}`,
          value,
          EXTSTORE_CACHE_TTL_MS,
        );
      }
    } catch (err) {
      this.logger.warn(`extstore cache warm failed for ${storeId}: ${err}`);
    }
  }

  /**
   * Drop cached resolutions (disconnect / tenant purge / force-unbind):
   * the next resolve re-reads the platform instead of serving a stale
   * ACTIVE entry for up to the TTL.
   */
  async invalidate(
    storeId: string,
    opts?: { provider?: 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM'; domain?: string },
  ): Promise<void> {
    try {
      await this.cache.deleteGlobal(`extstore:${storeId}`);
      const domain = opts?.domain?.trim().toLowerCase();
      if (opts?.provider && domain) {
        await this.cache.deleteGlobal(`extstore:domain:${opts.provider}:${domain}`);
      }
    } catch (err) {
      this.logger.warn(`extstore cache invalidate failed for ${storeId}: ${err}`);
    }
  }

  private usable(resolved: BindingResolution): BindingResolution | null {
    // PENDING (connect in flight — the install landing needs it) and
    // ACTIVE resolve; DISCONNECTED / BLOCKED never do.
    if (resolved.status === 'PENDING' || resolved.status === 'ACTIVE') {
      return resolved;
    }
    return null;
  }
}
