/**
 * Webhook heal-on-signature-failure (J-01, G-07) — Phase 9 webhook lifecycle.
 *
 * Contract (shared with builder B, who wires the intake call site):
 *   maybeHealOnSignatureFailure(storeId, reason): Promise<void>
 *
 * When a delivery fails signature verification (missing secret, missing
 * signature, bad signature), the likeliest cause is a secret mismatch
 * between EcoMate and the provider — the store was reconnected elsewhere,
 * the hook was recreated by hand, or the secret was never agreed. Instead
 * of failing every delivery until an operator notices, heal
 * fire-and-forget: rotate the webhook secret + force-recreate the hooks
 * under the new secret.
 *
 * Safety rails:
 * - 10-minute per-(store, reason) cooldown (Redis key
 *   `webhook:heal:cooldown:<storeId>:<reason>` via CacheService, which
 *   falls back to its in-memory mirror when Redis is down; a local
 *   in-memory map covers the no-CacheService case). A burst of bad
 *   deliveries heals once, not once per delivery. The cooldown is set
 *   BEFORE healing so concurrent failures stampede into one heal.
 * - Never throws into the caller: intake calls this fire-and-forget and
 *   must never see a heal error in the response path.
 * - Tenant context: intake calls this from inside the store's tenant
 *   context (runWithTenant), which is enough. When no ambient context
 *   exists (a future caller outside intake), the resolver re-resolves
 *   the store → tenant and the heal runs inside that context; if that
 *   also fails, the heal logs and gives up (fail-closed, no cross-tenant
 *   access ever).
 * - Rotation is WooCommerce-only (StoresService.rotateWebhookSecret is a
 *   no-op for Shopify/Custom — see the per-provider matrix there), but
 *   the force-recreate still runs for every kind: a stale-URL or
 *   duplicated hook heals the same way.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { ExternalStoreResolver } from '../../external-stores/external-store-resolver.service';
import { getTenantContext, runWithTenant } from '../../tenancy/tenant-context';
import { StoresService } from '../stores.service';

/** Cooldown between heals for the same (store, reason) — jannat J-01. */
export const WEBHOOK_HEAL_COOLDOWN_MS = 10 * 60_000;

export function webhookHealCooldownKey(storeId: string, reason: string): string {
  return `webhook:heal:cooldown:${storeId}:${reason}`;
}

@Injectable()
export class WebhookHealService {
  private readonly logger = new Logger(WebhookHealService.name);
  /** Local cooldown mirror for the no-CacheService case (unit specs). */
  private readonly localCooldown = new Map<string, number>();

  constructor(
    private readonly stores: StoresService,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly resolver?: ExternalStoreResolver,
  ) {}

  /**
   * Fire-and-forget heal: rotate the webhook secret + force-recreate the
   * provider hooks. Gated by the 10-minute per-(store, reason) cooldown.
   * Never throws.
   */
  async maybeHealOnSignatureFailure(storeId: string, reason: string): Promise<void> {
    const key = webhookHealCooldownKey(storeId, reason);
    try {
      if (await this.isCoolingDown(key)) {
        this.logger.debug(`webhook heal skipped (cooldown): store ${storeId} reason ${reason}`);
        return;
      }
      // Set the cooldown BEFORE healing: concurrent failures for the same
      // store/reason collapse into this one heal.
      await this.markCoolingDown(key);
    } catch (err) {
      this.logger.warn(
        `webhook heal cooldown check failed for store ${storeId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    try {
      // Prefer the ambient tenant context (intake runs inside it); fall
      // back to resolving the store's tenant via the platform binding.
      if (getTenantContext()?.tenantId) {
        await this.heal(storeId, reason);
        return;
      }
      const resolved = await this.resolver?.resolveStore(storeId).catch(() => null);
      if (resolved?.tenantId) {
        await runWithTenant(
          { tenantId: resolved.tenantId, slug: 'webhook-heal', status: 'ACTIVE' },
          () => this.heal(storeId, reason),
        );
        return;
      }
      // No context and no resolution: attempt anyway (single-tenant/dev
      // contexts run without a tenant); Prisma fails closed if a tenant
      // is required, and the catch below logs it.
      await this.heal(storeId, reason);
    } catch (err) {
      this.logger.warn(
        `webhook heal failed for store ${storeId} (reason ${reason}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async heal(storeId: string, reason: string): Promise<void> {
    const rotated = await this.stores.rotateWebhookSecret(storeId);
    // ensureSecret: true — the rotation above already minted a secret for
    // a Woo store that had none, but the ensure must not depend on that:
    // a secret-less store heals (backfill + register) even if rotation
    // was a no-op (non-Woo kinds never generate; the ensure is a no-op
    // for the secret there too).
    const outcome = await this.stores.ensureStoreWebhooksBestEffort(storeId, {
      forceRecreate: true,
      ensureSecret: true,
    });
    if (outcome.status === 'ok') {
      this.logger.log(
        `webhook healed for store ${storeId} (reason ${reason}, secret rotated: ${rotated}, recreated ${outcome.recreated.length}, deleted ${outcome.deleted})`,
      );
    } else {
      this.logger.warn(
        `webhook heal ensure failed for store ${storeId} (reason ${reason}): ${outcome.error ?? 'unknown'}`,
      );
    }
  }

  private async isCoolingDown(key: string): Promise<boolean> {
    if (this.cache) {
      const hit = await this.cache.getGlobal<string>(key);
      if (hit !== undefined) return true;
    }
    const until = this.localCooldown.get(key);
    if (until !== undefined && Date.now() < until) return true;
    if (until !== undefined) this.localCooldown.delete(key);
    return false;
  }

  private async markCoolingDown(key: string): Promise<void> {
    this.localCooldown.set(key, Date.now() + WEBHOOK_HEAL_COOLDOWN_MS);
    if (this.cache) {
      await this.cache.setGlobal(key, '1', WEBHOOK_HEAL_COOLDOWN_MS);
    }
  }
}
