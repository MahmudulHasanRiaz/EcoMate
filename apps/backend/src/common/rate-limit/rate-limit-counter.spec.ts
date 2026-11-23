/**
 * Phase 9 G-13 — token-bucket math (RateLimitCounterService).
 *
 * The bucket starts FULL (capacity tokens), so a flash-sale burst up
 * to `capacity` passes instantly, then refills continuously at
 * `refillPerMinute`. The Redis path is one atomic Lua script with the
 * same math; these specs exercise the in-memory path (REDIS_URL
 * points at a dead port so the service never connects — the fallback
 * a single-replica deploy uses).
 */
import { RateLimitCounterService } from './rate-limit-counter.service';

describe('RateLimitCounterService token bucket (in-memory path)', () => {
  const OLD_REDIS_URL = process.env.REDIS_URL;
  let service: RateLimitCounterService;
  let nowSpy: jest.SpyInstance;
  let now = 1_700_000_000_000;

  beforeEach(() => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6399';
    now = 1_700_000_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    service = new RateLimitCounterService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    nowSpy.mockRestore();
    if (OLD_REDIS_URL === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = OLD_REDIS_URL;
  });

  it('lets a burst up to capacity through instantly, then denies', async () => {
    const key = 'bucket:burst';
    for (let i = 0; i < 5; i++) {
      const r = await service.consumeTokenBucket(key, 5, 600);
      expect(r.allowed).toBe(true);
    }
    const denied = await service.consumeTokenBucket(key, 5, 600);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    // 600/min = 1 token per 100ms — the next token is ~100ms away.
    expect(denied.resetMs).toBeGreaterThan(0);
    expect(denied.resetMs).toBeLessThanOrEqual(100);
  });

  it('refills continuously and caps at capacity', async () => {
    const key = 'bucket:refill';
    // Drain a 5-token bucket (600/min = 10/sec).
    for (let i = 0; i < 5; i++) {
      await service.consumeTokenBucket(key, 5, 600);
    }
    expect((await service.consumeTokenBucket(key, 5, 600)).allowed).toBe(false);

    // +100ms → 1 token refilled.
    now += 100;
    expect((await service.consumeTokenBucket(key, 5, 600)).allowed).toBe(true);
    expect((await service.consumeTokenBucket(key, 5, 600)).allowed).toBe(false);

    // +10s → fully refilled, but capped at 5 (not 100+).
    now += 10_000;
    for (let i = 0; i < 5; i++) {
      expect((await service.consumeTokenBucket(key, 5, 600)).allowed).toBe(true);
    }
    expect((await service.consumeTokenBucket(key, 5, 600)).allowed).toBe(false);
  });

  it('keeps buckets independent per key', async () => {
    await service.consumeTokenBucket('bucket:store-a', 1, 600);
    expect((await service.consumeTokenBucket('bucket:store-a', 1, 600)).allowed).toBe(false);
    // Another store's bucket is untouched.
    expect((await service.consumeTokenBucket('bucket:store-b', 1, 600)).allowed).toBe(true);
  });

  it('reports remaining tokens (floored) on allowed consumes', async () => {
    const first = await service.consumeTokenBucket('bucket:remaining', 200, 600);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(199);
    expect(first.resetMs).toBe(0);
  });

  it('absorbs the production default burst (200) at once', async () => {
    const key = 'bucket:prod-defaults';
    let allowed = 0;
    for (let i = 0; i < 200; i++) {
      if ((await service.consumeTokenBucket(key, 200, 600)).allowed) allowed += 1;
    }
    expect(allowed).toBe(200);
    expect((await service.consumeTokenBucket(key, 200, 600)).allowed).toBe(false);
  });
});
