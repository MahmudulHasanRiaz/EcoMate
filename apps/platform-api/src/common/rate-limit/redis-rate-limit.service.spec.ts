import {
  RedisRateLimitService,
  type RateLimitRedisClient,
} from './redis-rate-limit.service';

/** Minimal in-memory stand-in for the sorted-set commands the limiter uses. */
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

describe('RedisRateLimitService', () => {
  it('allows up to the limit then refuses within the window (Redis)', async () => {
    const service = new RedisRateLimitService(new FakeRedis());
    expect(service.isRedisBacked()).toBe(true);
    expect(await service.consume('ip:1.2.3.4', 2, 60_000)).toBe(true);
    expect(await service.consume('ip:1.2.3.4', 2, 60_000)).toBe(true);
    expect(await service.consume('ip:1.2.3.4', 2, 60_000)).toBe(false);
    // A different key has its own budget.
    expect(await service.consume('ip:5.6.7.8', 2, 60_000)).toBe(true);
  });

  it('slides the window: old hits stop counting (Redis)', async () => {
    const fake = new FakeRedis();
    const service = new RedisRateLimitService(fake);
    const key = 'rl:platform:ip:1.2.3.4';
    const old = Date.now() - 61_000;
    fake.sets.set(key, [
      { score: old, member: 'a' },
      { score: old, member: 'b' },
    ]);
    // Both stored hits are older than the 60s window, so the budget is free.
    expect(await service.consume('ip:1.2.3.4', 2, 60_000)).toBe(true);
    expect(await service.consume('ip:1.2.3.4', 2, 60_000)).toBe(true);
    expect(await service.consume('ip:1.2.3.4', 2, 60_000)).toBe(false);
  });

  it('assert throws 429 when the budget is exhausted', async () => {
    const service = new RedisRateLimitService(new FakeRedis());
    await service.assert('k', 1, 60_000);
    await expect(service.assert('k', 1, 60_000)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('falls back to in-memory counting when Redis commands fail', async () => {
    const failing: RateLimitRedisClient = {
      zremrangebyscore: async () => {
        throw new Error('ECONNREFUSED');
      },
      zcard: async () => {
        throw new Error('ECONNREFUSED');
      },
      zadd: async () => {
        throw new Error('ECONNREFUSED');
      },
      expire: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const service = new RedisRateLimitService(failing);
    // First consume fails over to memory; the budget still enforces.
    expect(await service.consume('ip:9.9.9.9', 1, 60_000)).toBe(true);
    expect(await service.consume('ip:9.9.9.9', 1, 60_000)).toBe(false);
    expect(service.isRedisBacked()).toBe(false);
  });
});
