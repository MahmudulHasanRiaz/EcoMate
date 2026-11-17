import { ExecutionContext } from '@nestjs/common';
import { RateLimitGuard, RATE_LIMIT_POLICIES } from './rate-limit.guard';
import {
  RedisRateLimitService,
  type RateLimitRedisClient,
} from './redis-rate-limit.service';

/** In-memory stand-in for the sorted-set commands the limiter uses. */
class FakeRedis implements RateLimitRedisClient {
  readonly sets = new Map<string, Array<{ score: number; member: string }>>();

  async zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number> {
    const entries = this.sets.get(key) ?? [];
    const kept = entries.filter(
      (e) => e.score < Number(min) || e.score > Number(max),
    );
    this.sets.set(key, kept);
    return entries.length - kept.length;
  }

  async zcard(key: string): Promise<number> {
    return (this.sets.get(key) ?? []).length;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const entries = this.sets.get(key) ?? [];
    entries.push({ score, member });
    this.sets.set(key, entries);
    return 1;
  }

  async expire(): Promise<number> {
    return 1;
  }
}

function makeContext(method: string, url: string, ip = '1.2.3.4') {
  const headers: Record<string, string> = {};
  const request: any = {
    method,
    url,
    ip,
    headers,
    socket: { remoteAddress: ip },
  };
  const response: any = { header: jest.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, response };
}

function makeGuard() {
  // Fake client: the spec must not depend on a live Redis (keys would
  // persist across runs and make the limits flaky).
  const limiter = new RedisRateLimitService(new FakeRedis());
  const guard = new RateLimitGuard(limiter);
  return { limiter, guard };
}

describe('RateLimitGuard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets unlisted routes through without touching the limiter', async () => {
    const { limiter, guard } = makeGuard();
    const consume = jest.spyOn(limiter, 'consume');
    const { context } = makeContext('GET', '/api/tenants');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
    limiter.onModuleDestroy();
  });

  it('limits POST /api/auth/login per IP and sets Retry-After on 429', async () => {
    const { limiter, guard } = makeGuard();
    const policy = RATE_LIMIT_POLICIES.find(
      (p) => p.method === 'POST' && p.path === '/api/auth/login',
    )!;
    for (let i = 0; i < policy.limit; i += 1) {
      const { context } = makeContext('POST', '/api/auth/login');
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
    const { context, response } = makeContext('POST', '/api/auth/login');
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    expect(response.header).toHaveBeenCalledWith(
      'Retry-After',
      String(Math.ceil(policy.windowMs / 1000)),
    );
    // A different IP still has budget.
    const other = makeContext('POST', '/api/auth/login', '9.9.9.9');
    await expect(guard.canActivate(other.context)).resolves.toBe(true);
    limiter.onModuleDestroy();
  });

  it('covers verify, status, invite-accept, refresh and mfa-challenge', async () => {
    const { limiter, guard } = makeGuard();
    const routes: Array<[string, string, number]> = [
      ['GET', '/api/public/signup/verify?token=x', 30],
      ['GET', '/api/public/signup/status?token=x', 30],
      ['POST', '/api/users/invite/accept', 10],
      ['POST', '/api/auth/refresh', 60],
      ['POST', '/api/auth/mfa/challenge', 10],
    ];
    for (const [method, url, limit] of routes) {
      for (let i = 0; i < limit; i += 1) {
        const { context } = makeContext(method, url);
        await expect(guard.canActivate(context)).resolves.toBe(true);
      }
      const { context } = makeContext(method, url);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 429,
      });
    }
    limiter.onModuleDestroy();
  });
});
