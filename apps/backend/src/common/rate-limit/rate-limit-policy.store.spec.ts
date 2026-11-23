/**
 * Phase 9 G-13 — store_webhook policy defaults + env overrides
 * (RateLimitPolicyStore).
 *
 * The store_webhook policy is a burst-tolerant token bucket per
 * store: 600/min sustained refill + 200-token burst, env-overridable
 * via STORE_WEBHOOK_RATE_LIMIT_PER_MIN / STORE_WEBHOOK_RATE_BURST.
 * Signed deliveries bypass volume limiting entirely (signedBypass).
 */
import {
  RateLimitPolicyStore,
  STORE_WEBHOOK_RATE_BURST_DEFAULT,
  STORE_WEBHOOK_RATE_LIMIT_DEFAULT_PER_MIN,
} from './rate-limit-policy.store';
import { TrustTier } from './trust-tier.enum';

describe('RateLimitPolicyStore store_webhook (G-13)', () => {
  const OLD_ENV = { ...process.env };
  let store: RateLimitPolicyStore;

  beforeEach(() => {
    delete process.env.STORE_WEBHOOK_RATE_LIMIT_PER_MIN;
    delete process.env.STORE_WEBHOOK_RATE_BURST;
    store = new RateLimitPolicyStore();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('defaults to the 600/min + 200-burst token bucket', () => {
    expect(STORE_WEBHOOK_RATE_LIMIT_DEFAULT_PER_MIN).toBe(600);
    expect(STORE_WEBHOOK_RATE_BURST_DEFAULT).toBe(200);
    const p = store.get('store_webhook');
    expect(p.name).toBe('store_webhook');
    expect(p.trackingKey).toBe('store');
    expect(p.signedBypass).toBe(true);
    expect(p.tokenBucket).toEqual({ capacity: 200, refillPerMinute: 600 });
    for (const tier of Object.values(TrustTier)) {
      expect(p.limits[tier]).toEqual({ limit: 600, windowMs: 60000 });
    }
  });

  it('applies env overrides to the bucket and the tier limits', () => {
    process.env.STORE_WEBHOOK_RATE_LIMIT_PER_MIN = '1200';
    process.env.STORE_WEBHOOK_RATE_BURST = '50';
    const p = store.get('store_webhook');
    expect(p.tokenBucket).toEqual({ capacity: 50, refillPerMinute: 1200 });
    expect(p.limits[TrustTier.UNKNOWN]).toEqual({ limit: 1200, windowMs: 60000 });
  });

  it('falls back to defaults on invalid env values', () => {
    for (const bad of ['abc', '0', '-5', 'NaN', '']) {
      process.env.STORE_WEBHOOK_RATE_LIMIT_PER_MIN = bad;
      process.env.STORE_WEBHOOK_RATE_BURST = bad;
      const p = store.get('store_webhook');
      expect(p.tokenBucket).toEqual({ capacity: 200, refillPerMinute: 600 });
    }
  });

  it('floors fractional env values', () => {
    process.env.STORE_WEBHOOK_RATE_LIMIT_PER_MIN = '750.9';
    process.env.STORE_WEBHOOK_RATE_BURST = '33.7';
    const p = store.get('store_webhook');
    expect(p.tokenBucket).toEqual({ capacity: 33, refillPerMinute: 750 });
  });

  it('does not apply the webhook env overlay to other policies', () => {
    process.env.STORE_WEBHOOK_RATE_LIMIT_PER_MIN = '1200';
    process.env.STORE_WEBHOOK_RATE_BURST = '50';
    const p = store.get('courier_webhook');
    expect(p.tokenBucket).toBeUndefined();
    expect(p.signedBypass).toBeUndefined();
    expect(p.limits[TrustTier.UNKNOWN]).toEqual({ limit: 60, windowMs: 60000 });
  });

  it('falls back to the api policy for unknown names', () => {
    const p = store.get('no-such-policy');
    expect(p.name).toBe('api');
  });
});
