/**
 * Phase 9 G-13 — risk-score accumulation window (RiskScoreService).
 *
 * The old window computation was dead code: a ternary that always
 * resolved to the UNKNOWN tier (always 60000) wrapped in
 * `Math.max(..., 300000)`, forcing EVERY policy to a 5-minute
 * window — so 2 violations in 5 minutes auto-blocked a Woo server's
 * IP for 24h. The window now scales with the policy's own threshold
 * (N violations to block → N minutes to accumulate them), floored at
 * 1 minute and capped at the old 5-minute effective ceiling.
 */
import { RiskScoreService } from './risk-score.service';
import { TrustTier } from './trust-tier.enum';
import type { RateLimitPolicy } from './rate-limit-policy.interface';

function policy(overrides: Partial<RateLimitPolicy['riskScore']>): RateLimitPolicy {
  return {
    name: 'test',
    limits: {
      [TrustTier.UNKNOWN]: { limit: 10, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 10, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 10, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 10, windowMs: 60000 },
    },
    riskScore: {
      violationWeight: 1,
      autoBlockThreshold: 10,
      autoBlockDurationMinutes: 1440,
      ...overrides,
    },
    trackingKey: 'identity',
  };
}

describe('RiskScoreService score-accumulation window', () => {
  let service: RiskScoreService;
  let nowSpy: jest.SpyInstance;
  let now = 1_700_000_000_000;
  const blockedEntries = { createAutoBlock: jest.fn() };
  const eventEmitter = { emit: jest.fn() };

  beforeEach(() => {
    now = 1_700_000_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    blockedEntries.createAutoBlock.mockResolvedValue(undefined);
    eventEmitter.emit.mockResolvedValue(undefined);
    service = new RiskScoreService(blockedEntries as any, eventEmitter as any);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('gives a threshold-3 policy a 3-minute window (not 5)', async () => {
    const p = policy({ violationWeight: 1, autoBlockThreshold: 3 });
    // Two violations 2 minutes apart accumulate (inside 3 min).
    await service.recordViolation('ip:1.2.3.4', '1.2.3.4', p, false);
    now += 2 * 60_000;
    const second = await service.recordViolation('ip:1.2.3.4', '1.2.3.4', p, false);
    expect(second.riskScore).toBe(2);
    expect(second.autoBlocked).toBe(false);

    // A violation 4 minutes after the FIRST falls outside the 3-min
    // window — the score resets instead of blocking.
    now += 2 * 60_000; // t = 4 min from first
    const third = await service.recordViolation('ip:1.2.3.4', '1.2.3.4', p, false);
    expect(third.riskScore).toBe(1);
    expect(third.autoBlocked).toBe(false);
    expect(blockedEntries.createAutoBlock).not.toHaveBeenCalled();
  });

  it('blocks when the threshold is reached inside the window', async () => {
    const p = policy({ violationWeight: 1, autoBlockThreshold: 3 });
    await service.recordViolation('ip:1.2.3.4', '1.2.3.4', p, false);
    now += 60_000;
    await service.recordViolation('ip:1.2.3.4', '1.2.3.4', p, false);
    now += 60_000;
    const third = await service.recordViolation('ip:1.2.3.4', '1.2.3.4', p, false);
    expect(third.autoBlocked).toBe(true);
    expect(third.riskScore).toBe(3);
    expect(blockedEntries.createAutoBlock).toHaveBeenCalledWith('ip', '1.2.3.4', 'order', 1440);
  });

  it('caps the window at 5 minutes for high-threshold policies', async () => {
    // Threshold 10 → 10 minutes of window by the rule, capped at 5.
    const p = policy({ violationWeight: 1, autoBlockThreshold: 10 });
    await service.recordViolation('ip:5.6.7.8', '5.6.7.8', p, false);
    now += 4 * 60_000;
    const inside = await service.recordViolation('ip:5.6.7.8', '5.6.7.8', p, false);
    expect(inside.riskScore).toBe(2); // 4 min apart still accumulates
    now += 2 * 60_000; // 6 min from first → outside the 5-min cap
    const outside = await service.recordViolation('ip:5.6.7.8', '5.6.7.8', p, false);
    expect(outside.riskScore).toBe(1);
  });

  it('weights violations (store_webhook: 2 probes in 5 min still block)', async () => {
    // The store_webhook policy keeps weight 5 / threshold 10 — two
    // SCANNER probes inside the window block the probe IP. (Verified
    // and webhook-identified traffic never reaches here — see the
    // guard spec; this service stays policy-generic.)
    const p = policy({ violationWeight: 5, autoBlockThreshold: 10 });
    const first = await service.recordViolation('ip:9.9.9.9', '9.9.9.9', p, false);
    expect(first.autoBlocked).toBe(false);
    const second = await service.recordViolation('ip:9.9.9.9', '9.9.9.9', p, false);
    expect(second.autoBlocked).toBe(true);
    expect(blockedEntries.createAutoBlock).toHaveBeenCalledTimes(1);
  });

  it('never blocks a whitelisted identity', async () => {
    const p = policy({ violationWeight: 5, autoBlockThreshold: 10 });
    const r = await service.recordViolation('ip:1.1.1.1', '1.1.1.1', p, true);
    expect(r).toEqual({ autoBlocked: false, riskScore: 0 });
    expect(blockedEntries.createAutoBlock).not.toHaveBeenCalled();
  });

  it('does not throw when the auto-block write fails', async () => {
    blockedEntries.createAutoBlock.mockRejectedValueOnce(new Error('db down'));
    const p = policy({ violationWeight: 10, autoBlockThreshold: 10 });
    await expect(
      service.recordViolation('ip:2.2.2.2', '2.2.2.2', p, false),
    ).resolves.toEqual({ autoBlocked: false, riskScore: 10 });
  });
});
