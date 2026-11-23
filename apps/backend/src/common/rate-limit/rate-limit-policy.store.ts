import { Injectable, Logger } from '@nestjs/common';
import { TrustTier } from './trust-tier.enum';
import { RateLimitPolicy } from './rate-limit-policy.interface';
import { BlockSettingsService } from '../../block-settings/block-settings.service';

const DEFAULT_POLICIES: Record<string, Omit<RateLimitPolicy, 'name'>> = {
  /**
   * Storefront — public browsing, product pages, catalog.
   * Designed for high traffic campaigns & flash sales.
   * UNKNOWN tier alone handles 100/min × N IPs = high aggregate throughput.
   */
  storefront: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 100, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 300, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 500, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 1000, windowMs: 60000 },
    },
    burst: { limit: 50, windowMs: 10000 },
    riskScore: { violationWeight: 1, autoBlockThreshold: 20, autoBlockDurationMinutes: 60 },
    trackingKey: 'identity',
  },

  /**
   * Auth endpoints — login, register, password reset.
   * Sensitive — tight limits even for authenticated users.
   */
  auth: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 10, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 20, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 30, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 60, windowMs: 60000 },
    },
    burst: { limit: 15, windowMs: 10000 },
    riskScore: { violationWeight: 3, autoBlockThreshold: 5, autoBlockDurationMinutes: 1440 },
    trackingKey: 'identity',
  },

  /**
   * Checkout & payment — order placement, payment initiation.
   * Strictest limits regardless of trust tier.
   */
  checkout: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 5, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 10, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 15, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 30, windowMs: 60000 },
    },
    burst: { limit: 5, windowMs: 10000 },
    riskScore: { violationWeight: 5, autoBlockThreshold: 3, autoBlockDurationMinutes: 1440 },
    trackingKey: 'identity',
  },

  /**
   * Admin panel — management, user CRUD, settings.
   * Only accessible to authenticated admin users.
   */
  admin: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 10, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 20, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 50, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 200, windowMs: 60000 },
    },
    riskScore: { violationWeight: 2, autoBlockThreshold: 10, autoBlockDurationMinutes: 1440 },
    trackingKey: 'identity',
  },

  /**
   * POS — point of sale operations.
   * High-volume per authenticated staff.
   */
  pos: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 10, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 30, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 60, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 300, windowMs: 60000 },
    },
    riskScore: { violationWeight: 2, autoBlockThreshold: 15, autoBlockDurationMinutes: 1440 },
    trackingKey: 'identity',
  },

  /**
   * Webhooks — payment callbacks, courier updates.
   * Signature validation is primary protection.
   */
  webhooks: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 5, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 10, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 20, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 500, windowMs: 60000 },
    },
    riskScore: { violationWeight: 10, autoBlockThreshold: 3, autoBlockDurationMinutes: 1440 },
    trackingKey: 'ip',
  },

  /**
   * Courier webhooks — status callbacks from Steadfast, Pathao, RedX, Carrybee.
   * Providers send bursts of callbacks during bulk deliveries (10-20 in seconds).
   * 60/min per source IP allows 1 req/sec sustained + burst headroom.
   * Signature/bearer validation is the primary auth gate.
   */
  courier_webhook: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 60, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 60, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 60, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 60, windowMs: 60000 },
    },
    burst: { limit: 20, windowMs: 10000 },
    riskScore: { violationWeight: 5, autoBlockThreshold: 10, autoBlockDurationMinutes: 1440 },
    trackingKey: 'ip',
  },

  /**
   * Store webhooks — WooCommerce / Shopify / Custom bridge order + product
   * events. HMAC signature verification is the primary auth gate; limits
   * are per (store, source IP) with burst headroom for reconcile-driven
   * retries. P0 foundation for central-commerce §8.7 (public, signed,
   * rate-limited). The `store` tracking key scopes the counter by the
   * `:storeKey` route param (webhooks) or `storeId` query param (bridge
   * contact-check) — an IP-only key would let one store's flood exhaust
   * every other store's budget.
   *
   * Phase 9 G-13 rework (Woo never retries a failed delivery and DISABLES
   * the webhook after 7 consecutive failures — a 429 on a legitimate
   * burst permanently loses orders AND kills the webhook):
   *  - Burst-tolerant TOKEN BUCKET per store: 600/min sustained refill
   *    with a 200-token burst allowance (env-overridable — see
   *    `storeWebhookEnvOverlay` below). A single Woo store physically
   *    delivers at most ~2/sec through Action Scheduler, so 600/min is
   *    5x headroom over any legitimate burst; the 200-token bucket
   *    absorbs a flash-sale spike instantly.
   *  - `signedBypass`: a request carrying a webhook signature header
   *    skips volume limiting at the edge entirely — a signed, VERIFIED
   *    delivery is NEVER 429'd for volume. Excess verified traffic is
   *    accepted and queued (backpressure at the queue, not rejection at
   *    the edge). The bucket gates UNSIGNED traffic only.
   *  - Risk score: the guard feeds `recordViolation` for this policy
   *    ONLY for scanner probes (no webhook headers at all — see the
   *    guard). Verified traffic never reaches the risk scorer, and an
   *    unsigned-but-identified store (missing secret, misconfigured)
   *    is healed, never blocked. The weight/threshold below therefore
   *    apply to probes only.
   */
  store_webhook: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 600, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 600, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 600, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 600, windowMs: 60000 },
    },
    tokenBucket: { capacity: 200, refillPerMinute: 600 },
    signedBypass: true,
    riskScore: { violationWeight: 5, autoBlockThreshold: 10, autoBlockDurationMinutes: 1440 },
    trackingKey: 'store',
  },

  /**
   * Health — very high limit, never block normal checks.
   */
  health: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 100, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 100, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 100, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 100, windowMs: 60000 },
    },
    riskScore: { violationWeight: 1, autoBlockThreshold: 50, autoBlockDurationMinutes: 10 },
    trackingKey: 'ip',
  },

  /**
   * Browser trust challenge — lightweight endpoint.
   */
  browser_check: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 100, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 100, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 200, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 200, windowMs: 60000 },
    },
    riskScore: { violationWeight: 1, autoBlockThreshold: 50, autoBlockDurationMinutes: 10 },
    trackingKey: 'ip',
  },

  /**
   * Public enumeration-sensitive endpoints (SECURITY 2026-10-25, F19):
   * coupon validation, discount evaluation, public reviews, and the
   * public order lookups. These are unauthenticated and cheap to abuse
   * for code/order enumeration, so they get a much tighter budget than
   * the general api policy — a legitimate shopper validating one coupon
   * or tracking one order never notices.
   */
  strict_public: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 20, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 40, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 60, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 120, windowMs: 60000 },
    },
    burst: { limit: 10, windowMs: 10000 },
    riskScore: { violationWeight: 2, autoBlockThreshold: 10, autoBlockDurationMinutes: 60 },
    trackingKey: 'identity',
  },

  /**
   * General API — default for unprotected routes.
   */
  api: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 60, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 120, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 200, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 500, windowMs: 60000 },
    },
    burst: { limit: 30, windowMs: 10000 },
    riskScore: { violationWeight: 1, autoBlockThreshold: 20, autoBlockDurationMinutes: 60 },
    trackingKey: 'identity',
  },
};

/**
 * Phase 9 G-13 env overrides for the store_webhook token bucket.
 * Read fresh on every get() (cheap; keeps tests deterministic without a
 * module reload). Invalid values fall back to the defaults — a low
 * value cannot hurt order intake: the bucket gates UNSIGNED traffic
 * only (signed deliveries bypass it via `signedBypass`).
 */
export const STORE_WEBHOOK_RATE_LIMIT_DEFAULT_PER_MIN = 600;
export const STORE_WEBHOOK_RATE_BURST_DEFAULT = 200;

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function storeWebhookEnvOverlay(): Pick<RateLimitPolicy, 'limits' | 'tokenBucket'> {
  const perMin = envPositiveInt(
    'STORE_WEBHOOK_RATE_LIMIT_PER_MIN',
    STORE_WEBHOOK_RATE_LIMIT_DEFAULT_PER_MIN,
  );
  const burst = envPositiveInt(
    'STORE_WEBHOOK_RATE_BURST',
    STORE_WEBHOOK_RATE_BURST_DEFAULT,
  );
  return {
    limits: {
      [TrustTier.UNKNOWN]: { limit: perMin, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: perMin, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: perMin, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: perMin, windowMs: 60000 },
    },
    tokenBucket: { capacity: burst, refillPerMinute: perMin },
  };
}

@Injectable()
export class RateLimitPolicyStore {
  private readonly logger = new Logger(RateLimitPolicyStore.name);
  private overrides: Record<string, Partial<Omit<RateLimitPolicy, 'name'>>> = {};

  constructor(
    private readonly blockSettings?: BlockSettingsService,
  ) {}

  get(policyName: string): RateLimitPolicy {
    let defaults = DEFAULT_POLICIES[policyName];
    if (!defaults) {
      this.logger.warn(`Unknown rate limit policy "${policyName}", falling back to api`);
      return this.get('api');
    }

    // Env overrides apply to the defaults BEFORE the settings-override
    // merge below, so an admin settings override still wins over env.
    if (policyName === 'store_webhook') {
      defaults = { ...defaults, ...storeWebhookEnvOverlay() };
    }

    const override = this.overrides[policyName];
    if (!override) {
      return { name: policyName, ...defaults };
    }

    return {
      name: policyName,
      limits: {
        [TrustTier.UNKNOWN]: override.limits?.[TrustTier.UNKNOWN] ?? defaults.limits[TrustTier.UNKNOWN],
        [TrustTier.SESSION]: override.limits?.[TrustTier.SESSION] ?? defaults.limits[TrustTier.SESSION],
        [TrustTier.BROWSER_TRUST]: override.limits?.[TrustTier.BROWSER_TRUST] ?? defaults.limits[TrustTier.BROWSER_TRUST],
        [TrustTier.AUTHENTICATED]: override.limits?.[TrustTier.AUTHENTICATED] ?? defaults.limits[TrustTier.AUTHENTICATED],
      },
      burst: override.burst ?? defaults.burst,
      tokenBucket: override.tokenBucket ?? defaults.tokenBucket,
      signedBypass: override.signedBypass ?? defaults.signedBypass,
      riskScore: override.riskScore ?? defaults.riskScore,
      trackingKey: override.trackingKey ?? defaults.trackingKey,
    };
  }

  listPolicies(): string[] {
    return Object.keys(DEFAULT_POLICIES);
  }

  async loadOverridesFromSettings(): Promise<void> {
    try {
      if (!this.blockSettings) return;
      const settings = await this.blockSettings.getSettings();
      const rateLimitConfig = (settings as any).rateLimitPolicies;
      if (rateLimitConfig && typeof rateLimitConfig === 'object') {
        this.overrides = rateLimitConfig;
        this.logger.log(`Loaded rate limit policy overrides from settings`);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to load rate limit policy overrides: ${err.message}`);
    }
  }
}
