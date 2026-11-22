/**
 * Store-scoped rate limiting — SaaS §3.3 (Phase 9).
 *
 * Policies with `trackingKey: 'store'` scope their counter (and burst)
 * by (store, IP): the store key comes from the `:storeKey` route param
 * (webhooks) or the `storeId` query param (bridge contact-check); without
 * either, the guard falls back to IP-only. One store's flood must never
 * exhaust another store's budget. Every other policy keeps its existing
 * identity keying — this spec proves that too.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AdaptiveRateLimiterGuard, setWhitelistedIdentity, removeWhitelistedIdentity } from './adaptive-rate-limiter.guard';
import { TrustTierService } from './trust-tier.service';
import { RateLimitPolicyStore } from './rate-limit-policy.store';
import { RateLimitCounterService } from './rate-limit-counter.service';
import { RiskContextService } from './risk-context.service';
import { RiskScoreService } from './risk-score.service';
import { TrustTier } from './trust-tier.enum';
import type { RateLimitPolicy } from './rate-limit-policy.interface';
import { SecurityEventEmitterService } from '../../security-dashboard/services/security-event-emitter.service';

const STORE_POLICY: RateLimitPolicy = {
  name: 'store_webhook',
  limits: {
    [TrustTier.UNKNOWN]: { limit: 60, windowMs: 60000 },
    [TrustTier.SESSION]: { limit: 60, windowMs: 60000 },
    [TrustTier.BROWSER_TRUST]: { limit: 60, windowMs: 60000 },
    [TrustTier.AUTHENTICATED]: { limit: 60, windowMs: 60000 },
  },
  burst: { limit: 20, windowMs: 10000 },
  riskScore: { violationWeight: 5, autoBlockThreshold: 10, autoBlockDurationMinutes: 1440 },
  trackingKey: 'store',
};

const IDENTITY_POLICY: RateLimitPolicy = {
  name: 'api',
  limits: {
    [TrustTier.UNKNOWN]: { limit: 10, windowMs: 60000 },
    [TrustTier.SESSION]: { limit: 50, windowMs: 60000 },
    [TrustTier.BROWSER_TRUST]: { limit: 30, windowMs: 60000 },
    [TrustTier.AUTHENTICATED]: { limit: 100, windowMs: 60000 },
  },
  burst: { limit: 5, windowMs: 10000 },
  riskScore: { violationWeight: 1, autoBlockThreshold: 10, autoBlockDurationMinutes: 5 },
  trackingKey: 'identity',
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
};
const mockRiskContext = {};
const mockRiskScore = { recordViolation: jest.fn() };

let reply: FastifyReply;

function makeReq(opts: {
  params?: Record<string, string>;
  query?: Record<string, string>;
  url?: string;
} = {}): FastifyRequest {
  return {
    cookies: {},
    url: opts.url ?? '',
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    params: opts.params ?? {},
    query: opts.query ?? {},
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply {
  let statusCode = 200;
  let sentBody: any = null;
  const headers: Record<string, string> = {};
  return {
    header: jest.fn((k: string, v: string) => { headers[k] = v; }),
    status: jest.fn((c: number) => { statusCode = c; return reply; }),
    send: jest.fn((b: any) => { sentBody = b; }),
    setCookie: jest.fn(),
    get headers() { return headers; },
    get statusCode() { return statusCode; },
    get sentBody() { return sentBody; },
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
      { provide: SecurityEventEmitterService, useValue: { emit: jest.fn().mockResolvedValue({ id: 'test', dedupKey: 'test', enqueued: true }) } },
    ],
  }).compile();
  return module.get<AdaptiveRateLimiterGuard>(AdaptiveRateLimiterGuard);
}

function setupMocks(policy: RateLimitPolicy) {
  mockReflector.get.mockReturnValue(policy.name);
  mockPolicyStore.get.mockImplementation((name?: string) =>
    name === policy.name ? policy : IDENTITY_POLICY,
  );
  mockTierService.determine.mockReturnValue({ tier: TrustTier.UNKNOWN, identity: 'ip:127.0.0.1' });
  mockTierService.extractIp.mockReturnValue('127.0.0.1');
  mockTierService.createSessionCookieValue.mockReturnValue({ value: 'sess.cookie.val', id: 'sess1' });
  mockCounter.increment = jest.fn().mockResolvedValue({ count: 1, remaining: 9, resetMs: 50000 });
  mockCounter.buildKey = jest.fn().mockReturnValue('rl:default:test:unknown:ip:127.0.0.1');
  mockRiskScore.recordViolation = jest.fn();
  setWhitelistedIdentity('ip:127.0.0.1');
  removeWhitelistedIdentity('ip:127.0.0.1');
}

/** The 4th buildKey arg is the identity; the 3rd arg selects main vs burst. */
function buildKeyIdentities(scope: string): string[] {
  return mockCounter.buildKey.mock.calls
    .filter((call: any[]) => call[2] === scope)
    .map((call: any[]) => call[3] as string);
}

beforeEach(async () => {
  reply = makeReply();
  guard = await createGuard();
});

afterEach(() => {
  guard.onModuleDestroy();
  jest.clearAllMocks();
});

describe('store trackingKey (Phase 9 §3.3)', () => {
  it(':storeKey route param scopes the counter by (store, IP)', async () => {
    setupMocks(STORE_POLICY);
    const allowed = await guard.canActivate(
      makeCtx(makeReq({ params: { storeKey: 'store-1' } })),
    );
    expect(allowed).toBe(true);
    expect(buildKeyIdentities(TrustTier.UNKNOWN)).toEqual([
      'store:store-1:ip:127.0.0.1',
    ]);
  });

  it('two stores from the same IP get different counter keys', async () => {
    setupMocks(STORE_POLICY);
    await guard.canActivate(makeCtx(makeReq({ params: { storeKey: 'store-1' } })));
    await guard.canActivate(makeCtx(makeReq({ params: { storeKey: 'store-2' } })));
    expect(buildKeyIdentities(TrustTier.UNKNOWN)).toEqual([
      'store:store-1:ip:127.0.0.1',
      'store:store-2:ip:127.0.0.1',
    ]);
  });

  it('?storeId= query param is the fallback source (bridge contact-check)', async () => {
    setupMocks(STORE_POLICY);
    await guard.canActivate(
      makeCtx(makeReq({ query: { storeId: 'store-9' } })),
    );
    expect(buildKeyIdentities(TrustTier.UNKNOWN)).toEqual([
      'store:store-9:ip:127.0.0.1',
    ]);
  });

  it('no store key at all falls back to IP-only (never crashes, never shares a store key)', async () => {
    setupMocks(STORE_POLICY);
    await guard.canActivate(makeCtx(makeReq({})));
    expect(buildKeyIdentities(TrustTier.UNKNOWN)).toEqual(['ip:127.0.0.1']);
  });

  it('route param wins over the query param when both are present', async () => {
    setupMocks(STORE_POLICY);
    await guard.canActivate(
      makeCtx(makeReq({ params: { storeKey: 'store-1' }, query: { storeId: 'store-2' } })),
    );
    expect(buildKeyIdentities(TrustTier.UNKNOWN)).toEqual([
      'store:store-1:ip:127.0.0.1',
    ]);
  });

  it('the burst key is store-scoped too for store policies', async () => {
    setupMocks(STORE_POLICY);
    await guard.canActivate(makeCtx(makeReq({ params: { storeKey: 'store-1' } })));
    expect(buildKeyIdentities(`${TrustTier.UNKNOWN}:burst`)).toEqual([
      'store:store-1:ip:127.0.0.1',
    ]);
  });

  it('identity policies keep their existing (unscoped) burst keying', async () => {
    setupMocks(IDENTITY_POLICY);
    await guard.canActivate(makeCtx(makeReq({ params: { storeKey: 'store-1' } })));
    expect(buildKeyIdentities(TrustTier.UNKNOWN)).toEqual(['ip:127.0.0.1']);
    expect(buildKeyIdentities(`${TrustTier.UNKNOWN}:burst`)).toEqual(['ip:127.0.0.1']);
  });
});

describe('store_webhook policy (real policy store)', () => {
  it('exists with trackingKey store, 60/min all tiers, burst 20/10s', () => {
    const store = new RateLimitPolicyStore();
    const policy = store.get('store_webhook');
    expect(policy.trackingKey).toBe('store');
    for (const tier of [
      TrustTier.UNKNOWN,
      TrustTier.SESSION,
      TrustTier.BROWSER_TRUST,
      TrustTier.AUTHENTICATED,
    ]) {
      expect(policy.limits[tier]).toEqual({ limit: 60, windowMs: 60000 });
    }
    expect(policy.burst).toEqual({ limit: 20, windowMs: 10000 });
  });
});
