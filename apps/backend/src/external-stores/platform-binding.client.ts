import { Injectable, Logger } from '@nestjs/common';

/**
 * Platform binding client — Phase 9 §3.4. The tenant backend's only
 * caller of the platform-api internal external-store endpoints
 * (guarded by InternalServiceGuard, `x-platform-service-token` — the
 * same pattern as TenantRegistrySyncService).
 *
 * Failure semantics, by method:
 * - resolve: 404 → null (unknown/unbound — no oracle); network/5xx →
 *   THROWS so the resolver can fail closed deliberately (a throw and a
 *   404 are different facts: outage vs unknown).
 * - claim: 409 → StoreAlreadyBoundError (generic, no identifying data);
 *   anything else unexpected → throws.
 * - release: 404 → false (nothing PENDING to release — fine on the
 *   failure path); anything else → throws.
 * - updateStatus / syncReport: 404 → null (binding gone, e.g.
 *   force-unbound); anything else unexpected → throws.
 *
 * One retry on network errors and 5xx only (never on 4xx). Every call
 * here is idempotent-or-safe-to-retry: claim has a platform-side
 * idempotent retry for the same tenant+storeId+fingerprint while
 * PENDING; status/sync-report/release are single-row writes keyed by
 * storeId. Timeout 5s, same as the registry sync.
 */

export type BindingStatus = 'PENDING' | 'ACTIVE' | 'DISCONNECTED' | 'BLOCKED';
export type SettableBindingStatus = 'ACTIVE' | 'DISCONNECTED' | 'BLOCKED';

export interface BindingResolution {
  tenantId: string;
  status: BindingStatus;
}

export interface ClaimBindingInput {
  storeId: string;
  tenantId: string;
  provider: 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM';
  providerStoreId?: string;
  domainNormalised?: string;
  identityFingerprint: string;
}

export interface SyncReportInput {
  lastSyncAt?: string;
  lastError?: string | null;
}

/** Generic claim collision — the caller maps this to a 409 with no identifying data. */
export class StoreAlreadyBoundError extends Error {
  constructor() {
    super('STORE_ALREADY_BOUND');
    this.name = 'StoreAlreadyBoundError';
  }
}

const CALL_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 250;

@Injectable()
export class PlatformBindingClient {
  private readonly logger = new Logger(PlatformBindingClient.name);

  /** False when the platform link is unconfigured — resolve/claim fail closed, sync-report no-ops. */
  isConfigured(): boolean {
    return Boolean(
      process.env.PLATFORM_API_URL && process.env.INTERNAL_SERVICE_SECRET,
    );
  }

  async resolveByStoreId(storeId: string): Promise<BindingResolution | null> {
    const res = await this.call(
      `/internal/external-stores/resolve?storeId=${encodeURIComponent(storeId)}`,
    );
    if (res.status === 404) return null;
    return this.expectOk<BindingResolution>(res, 'resolve');
  }

  async resolveByProviderDomain(
    provider: 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM',
    domain: string,
  ): Promise<BindingResolution | null> {
    const res = await this.call(
      `/internal/external-stores/resolve?provider=${encodeURIComponent(provider)}&domain=${encodeURIComponent(domain)}`,
    );
    if (res.status === 404) return null;
    return this.expectOk<BindingResolution>(res, 'resolve');
  }

  async claim(input: ClaimBindingInput): Promise<BindingResolution & { storeId: string }> {
    const res = await this.call('/internal/external-stores/claim', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (res.status === 409) throw new StoreAlreadyBoundError();
    return this.expectOk(res, 'claim');
  }

  async release(storeId: string): Promise<boolean> {
    const res = await this.call(
      `/internal/external-stores/${encodeURIComponent(storeId)}/release`,
      { method: 'POST' },
    );
    if (res.status === 404) return false;
    await this.expectOk(res, 'release');
    return true;
  }

  async updateStatus(
    storeId: string,
    status: SettableBindingStatus,
  ): Promise<BindingResolution | null> {
    const res = await this.call(
      `/internal/external-stores/${encodeURIComponent(storeId)}/status`,
      { method: 'POST', body: JSON.stringify({ status }) },
    );
    if (res.status === 404) return null;
    return this.expectOk<BindingResolution>(res, 'status update');
  }

  async syncReport(
    storeId: string,
    input: SyncReportInput,
  ): Promise<{ storeId: string; lastSyncAt: string; lastError: string | null } | null> {
    if (!this.isConfigured()) return null;
    const res = await this.call(
      `/internal/external-stores/${encodeURIComponent(storeId)}/sync-report`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    if (res.status === 404) return null;
    return this.expectOk(res, 'sync-report');
  }

  // ── Internals ───────────────────────────────────────────────────────

  private async call(
    path: string,
    init?: { method?: string; body?: string },
  ): Promise<Response> {
    const baseUrl = process.env.PLATFORM_API_URL?.replace(/\/+$/, '');
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!baseUrl || !secret) {
      throw new Error(
        'PLATFORM_API_URL / INTERNAL_SERVICE_SECRET not set — platform binding unavailable',
      );
    }
    const url = `${baseUrl}${path}`;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: init?.method ?? 'GET',
          headers: {
            'x-platform-service-token': secret,
            ...(init?.body ? { 'content-type': 'application/json' } : {}),
          },
          body: init?.body,
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        // 5xx is retried once; everything else (incl. 4xx) is final.
        if (res.status >= 500 && attempt === 0) {
          lastError = new Error(`platform binding HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw err;
      }
    }
    // Unreachable in practice (the loop always returns or throws) — kept
    // so a future refactor cannot silently swallow the last error.
    throw lastError instanceof Error
      ? lastError
      : new Error('platform binding call failed');
  }

  private async expectOk<T>(res: Response, op: string): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `platform binding ${op} failed: HTTP ${res.status} ${text.slice(0, 200)}`,
      );
      throw new Error(`platform binding ${op} failed: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
