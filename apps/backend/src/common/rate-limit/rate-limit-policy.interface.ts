import { TrustTier } from './trust-tier.enum';

export interface TierLimit {
  limit: number;
  windowMs: number;
}

export interface RiskScoreConfig {
  violationWeight: number;
  autoBlockThreshold: number;
  autoBlockDurationMinutes: number;
}

export interface RateLimitPolicy {
  name: string;
  limits: Record<TrustTier, TierLimit>;
  burst?: TierLimit;
  riskScore: RiskScoreConfig;
  /**
   * 'identity' = the trust-tier identity (user/session/browser-trust/IP);
   * 'ip' = the source IP only; 'store' = storeId + IP (Phase 9 — the
   * store key comes from the route param `:storeKey` or the `storeId`
   * query param; one abusive store cannot exhaust another store's
   * budget, and one abusive IP cannot exhaust a store's budget from a
   * second IP without also being per-store counted).
   */
  trackingKey: 'identity' | 'ip' | 'store';
  /**
   * Phase 9 G-13: when true, a request carrying a recognized webhook
   * signature header (`x-wc-webhook-signature`, `x-shopify-hmac-sha256`,
   * `x-ecomate-signature`) bypasses volume limiting entirely at the
   * edge. The signature is VERIFIED downstream by intake (HMAC over the
   * raw body) — the edge cannot verify it, it only recognizes the claim.
   * A signed, VERIFIED delivery is therefore never 429'd for volume:
   * excess verified traffic is accepted and queued (backpressure at the
   * queue, not rejection at the edge). 429 is reserved for unsigned
   * floods. Trade-off, documented: a flood of FAKE-signature requests
   * also bypasses the edge limiter — each costs a resolver-cache lookup
   * + HMAC verify and dies with 401 + a failure row (Builder B). That
   * cost is bounded and cheap; the alternative (a volume ceiling on
   * signed traffic) could 429 a genuine verified delivery, which the
   * pricing-approval hard ceiling forbids ("NO automated system may
   * ever stop/throttle/degrade order intake").
   */
  signedBypass?: boolean;
  /**
   * Phase 9 G-13: when set, the guard uses a token bucket instead of
   * the fixed-window + burst counters. `capacity` is the burst
   * allowance (tokens the bucket holds when full — a flash-sale burst
   * up to this size passes instantly); `refillPerMinute` is the
   * sustained rate (tokens added per minute, up to capacity). The
   * bucket is keyed exactly like the fixed-window counter (see
   * `trackingKey`), so a store_webhook bucket is per (store, IP).
   */
  tokenBucket?: { capacity: number; refillPerMinute: number };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  total: number;
  policy: string;
  tier: TrustTier;
}

export const RATE_LIMIT_POLICY_KEY = 'rate_limit_policy';
