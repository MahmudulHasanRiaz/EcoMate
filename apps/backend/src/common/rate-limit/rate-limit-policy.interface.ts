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
