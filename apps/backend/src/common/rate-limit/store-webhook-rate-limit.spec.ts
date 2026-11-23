/**
 * Phase 9 G-13 — store-webhook rate limiting at the guard.
 *
 * Hard ceiling (pricing approval): NO automated system may ever
 * stop/throttle/degrade order intake. These specs prove it at the
 * edge:
 *  - a SIGNED delivery is never 429'd for volume (burst of 1,000
 *    signed deliveries all accepted, limiter never consulted);
 *  - UNSIGNED traffic is gated by the per-(store, IP) token bucket
 *    (burst passes, sustained flood 429s);
 *  - a 429 NEVER feeds the 24h IP auto-block for webhook traffic —
 *    only scanner probes (no webhook headers at all) reach the risk
 *    scorer.
 *
 * Pure unit specs: the counter + risk scorer are mocked; the real
 * token-bucket math lives in rate-limit-counter.spec.ts.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  AdaptiveRateLimiterGuard,
  hasWebhookSignature,
  isWebhookIdentified,
  removeWhitelistedIdentity,
  setWhitelistedIdentity,
} from './adaptive-rate-limiter.guard';
import { TrustTierService } from './trust-tier.service';
import { RateLimitPolicyStore } from './rate-limit-policy.store';
import { RateLimitCounterService } from './rate-limit-counter.service';
import { RiskContextService } from './risk-context.service';
import { RiskScoreService } from './risk-score.service';
import { TrustTier } from './trust-tier.enum';
import type { RateLimitPolicy } from './rate-limit-policy.interface';
import { SecurityEventEmitterService } from '../../security-dashboard/services/security-event-emitter.service';

const STORE_WEBHOOK_POLICY: RateLimitPolicy = {
  name: 'store_webhook',
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
};

const mockReflector = { get: jest.fn() };
const mockPolicyStore = { get: jest.fn() };
const mockTierService = {
  determine: jest.fn(),
  extractIp: jest.fn(),
  createSessionCookieValue: jest.fn(),
};
const mockCounter = {
  buildKey: jest.fn(),
  increment: jest.fn(),
  consumeTokenBucket: jest.fn(),
};
const mockRiskContext = {};
const mockRiskScore = { recordViolation: jest.fn() };

let reply: FastifyReply;

function makeReq(
  headers: Record<string, string> = {},
  storeKey = 'store-abc',
): FastifyRequest {
  return {
    cookies: {},
    url: `/api/webhooks/stores/woocommerce/${storeKey}`,
    headers,
    params: { storeKey },
    query: {},
    ip: '203.0.113.7',
    socket: { remoteAddress: '203.0.113.7' },
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply {
  let statusCode = 200;
  let sentBody: any = null;
  const headers: Record<string, string> = {};
  return {
    header: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    status: jest.fn((c: number) => {
      statusCode = c;
      return reply;
    }),
    send: jest.fn((b: any) => {
      sentBody = b;
    }),
    setCookie: jest.fn(),
    get headers() {
      return headers;
    },
    get statusCode() {
      return statusCode;
    },
    get sentBody() {
      return sentBody;
    },
  } as unknown as FastifyReply;
}

function makeCtx(req: FastifyRequest) {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => reply,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
}

let guard: AdaptiveRateLimiterGuard;

async function createGuard() {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdaptiveRateLimiterGuard,
      { provide: Reflector, useValue: mockReflector },
      { provide: RateLimitPolicyStore, useValue: mockPolicyStore },
      { provide: TrustTierService, useValue: mockTierService },
      { provide: RateLimitCounterService, useValue: mockCounter },
      { provide: RiskContextService, useValue: mockRiskContext },
      { provide: RiskScoreService, useValue: mockRiskScore },
      { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-secret') } },
      {
        provide: SecurityEventEmitterService,
        useValue: { emit: jest.fn().mockResolvedValue({ id: 'test', dedupKey: 'test', enqueued: true }) },
      },
    ],
  }).compile();
  return module.get<AdaptiveRateLimiterGuard>(AdaptiveRateLimiterGuard);
}

beforeEach(async () => {
  reply = makeReply();
  guard = await createGuard();
  mockReflector.get.mockReturnValue('store_webhook');
  mockPolicyStore.get.mockReturnValue(STORE_WEBHOOK_POLICY);
  mockTierService.determine.mockReturnValue({ tier: TrustTier.UNKNOWN, identity: 'ip:203.0.113.7' });
  mockTierService.extractIp.mockReturnValue('203.0.113.7');
  mockTierService.createSessionCookieValue.mockReturnValue({ value: 'sess.cookie.val', id: 'sess1' });
  mockCounter.buildKey.mockImplementation(
    (t: string, p: string, tier: string, id: string) => `${t}:${p}:${tier}:${id}`,
  );
  mockCounter.increment.mockResolvedValue({ count: 1, remaining: 9, resetMs: 50000 });
  mockCounter.consumeTokenBucket.mockResolvedValue({ allowed: true, remaining: 199, resetMs: 0 });
  mockRiskScore.recordViolation.mockResolvedValue({ autoBlocked: false, riskScore: 0 });
});

afterEach(() => {
  guard.onModuleDestroy();
  removeWhitelistedIdentity('203.0.113.7');
  jest.clearAllMocks();
});

describe('G-13 header recognition helpers', () => {
  it('recognizes all three provider signature headers', () => {
    expect(hasWebhookSignature({ 'x-wc-webhook-signature': 'abc' })).toBe(true);
    expect(hasWebhookSignature({ 'x-shopify-hmac-sha256': 'abc' })).toBe(true);
    expect(hasWebhookSignature({ 'x-ecomate-signature': 'abc' })).toBe(true);
    expect(hasWebhookSignature({ 'x-wc-webhook-topic': 'order.created' })).toBe(false);
    expect(hasWebhookSignature({})).toBe(false);
    expect(hasWebhookSignature(undefined)).toBe(false);
  });

  it('treats topic/delivery headers as webhook-identified (no signature)', () => {
    expect(isWebhookIdentified({ 'x-wc-webhook-topic': 'order.created' })).toBe(true);
    expect(isWebhookIdentified({ 'x-wc-webhook-delivery-id': '123' })).toBe(true);
    expect(isWebhookIdentified({ 'x-shopify-topic': 'orders/create' })).toBe(true);
    expect(isWebhookIdentified({ 'user-agent': 'curl/8' })).toBe(false);
    expect(isWebhookIdentified({})).toBe(false);
  });
});

describe('G-13 verified bursts are never 429’d', () => {
  it('accepts a burst of 1,000 signed deliveries without consulting the limiter', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 1000; i++) {
      results.push(
        await guard.canActivate(
          makeCtx(
            makeReq({
              'x-wc-webhook-signature': `sig-${i}`,
              'x-wc-webhook-topic': 'order.created',
              'x-wc-webhook-delivery-id': String(1000 + i),
            }),
          ),
        ),
      );
    }
    expect(results).toHaveLength(1000);
    expect(results.every((r) => r === true)).toBe(true);
    // The edge limiter is never even consulted for signed traffic —
    // no token is consumed and no violation can be recorded.
    expect(mockCounter.consumeTokenBucket).not.toHaveBeenCalled();
    expect(mockCounter.increment).not.toHaveBeenCalled();
    expect(mockRiskScore.recordViolation).not.toHaveBeenCalled();
    expect(reply.statusCode).toBe(200);
  });

  it('bypasses for every provider signature header', async () => {
    for (const header of [
      'x-wc-webhook-signature',
      'x-shopify-hmac-sha256',
      'x-ecomate-signature',
    ]) {
      const allowed = await guard.canActivate(makeCtx(makeReq({ [header]: 'deadbeef' })));
      expect(allowed).toBe(true);
    }
    expect(mockCounter.consumeTokenBucket).not.toHaveBeenCalled();
  });

  it('still bypasses when the bucket is empty (signed traffic is volume-proof)', async () => {
    // Even a fully drained bucket cannot 429 a signed delivery.
    mockCounter.consumeTokenBucket.mockResolvedValue({ allowed: false, remaining: 0, resetMs: 60000 });
    const allowed = await guard.canActivate(
      makeCtx(makeReq({ 'x-wc-webhook-signature': 'sig', 'x-wc-webhook-topic': 'order.created' })),
    );
    expect(allowed).toBe(true);
    expect(mockCounter.consumeTokenBucket).not.toHaveBeenCalled();
  });
});

describe('G-13 unsigned traffic uses the token bucket', () => {
  it('passes a burst within capacity, then 429s a sustained unsigned flood', async () => {
    // Fake bucket with capacity 3 (the real math is in the counter spec).
    let tokens = 3;
    mockCounter.consumeTokenBucket.mockImplementation(async () => {
      if (tokens > 0) {
        tokens -= 1;
        return { allowed: true, remaining: tokens, resetMs: 0 };
      }
      return { allowed: false, remaining: 0, resetMs: 100 };
    });

    for (let i = 0; i < 3; i++) {
      expect(await guard.canActivate(makeCtx(makeReq()))).toBe(true);
    }
    const flooded = await guard.canActivate(makeCtx(makeReq()));
    expect(flooded).toBe(false);
    expect(reply.statusCode).toBe(429);
    expect(reply.sentBody).toMatchObject({ statusCode: 429, policy: 'store_webhook' });
  });

  it('scopes the bucket key per (store, IP)', async () => {
    await guard.canActivate(makeCtx(makeReq({}, 'store-xyz')));
    expect(mockCounter.buildKey).toHaveBeenCalledWith(
      'default',
      'store_webhook',
      'unknown:bucket',
      'store:store-xyz:ip:203.0.113.7',
    );
  });

  it('reports the refill rate (not the burst) as the rate-limit header', async () => {
    await guard.canActivate(makeCtx(makeReq()));
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', '600');
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Policy', 'store_webhook');
  });

  it('gives whitelisted IPs 5x bucket capacity and refill', async () => {
    setWhitelistedIdentity('203.0.113.7');
    await guard.canActivate(makeCtx(makeReq()));
    expect(mockCounter.consumeTokenBucket).toHaveBeenCalledWith(
      expect.any(String),
      200 * 5,
      600 * 5,
    );
  });
});

describe('G-13 auto-block boundary: webhook traffic never auto-blocks', () => {
  async function forceBucket429(headers: Record<string, string>) {
    mockCounter.consumeTokenBucket.mockResolvedValue({ allowed: false, remaining: 0, resetMs: 100 });
    const allowed = await guard.canActivate(makeCtx(makeReq(headers)));
    expect(allowed).toBe(false);
    expect(reply.statusCode).toBe(429);
  }

  it('an unsigned request WITH webhook headers never feeds the risk scorer', async () => {
    // A misconfigured store (missing secret, wrong URL) is healed,
    // never blocked — even when it floods past the bucket.
    await forceBucket429({ 'x-wc-webhook-topic': 'order.created' });
    expect(mockRiskScore.recordViolation).not.toHaveBeenCalled();

    await forceBucket429({ 'x-shopify-topic': 'orders/create', 'x-shopify-shop-domain': 'x.myshopify.com' });
    expect(mockRiskScore.recordViolation).not.toHaveBeenCalled();
  });

  it('only a scanner probe (no webhook headers at all) feeds the risk scorer', async () => {
    await forceBucket429({});
    expect(mockRiskScore.recordViolation).toHaveBeenCalledTimes(1);
    expect(mockRiskScore.recordViolation).toHaveBeenCalledWith(
      'ip:203.0.113.7',
      '203.0.113.7',
      expect.objectContaining({ name: 'store_webhook' }),
      false,
    );
  });

  it('a probe with only a user-agent still counts as a probe', async () => {
    await forceBucket429({ 'user-agent': 'masscan/1.0' });
    expect(mockRiskScore.recordViolation).toHaveBeenCalledTimes(1);
  });
});
