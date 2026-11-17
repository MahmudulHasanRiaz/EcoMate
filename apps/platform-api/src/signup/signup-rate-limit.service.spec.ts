import { HttpException } from '@nestjs/common';
import { RedisRateLimitService } from '../common/rate-limit/redis-rate-limit.service';
import { SignupRateLimitService } from './signup-rate-limit.service';

describe('SignupRateLimitService', () => {
  function makeService() {
    // 'memory' mode: no live Redis, so the spec is hermetic. The Redis
    // sliding-window behaviour itself is covered by
    // redis-rate-limit.service.spec.ts.
    const limiter = new RedisRateLimitService('memory');
    const service = new SignupRateLimitService(limiter);
    return { limiter, service };
  }

  it('allows up to the limit inside the window, then blocks', async () => {
    const { service } = makeService();
    for (let i = 0; i < 5; i++) {
      await expect(service.consume('ip', 5, 60_000)).resolves.toBe(true);
    }
    await expect(service.consume('ip', 5, 60_000)).resolves.toBe(false);
  });

  it('keeps independent keys independent', async () => {
    const { service } = makeService();
    for (let i = 0; i < 3; i++) {
      await expect(service.consume('a', 3, 60_000)).resolves.toBe(true);
    }
    await expect(service.consume('a', 3, 60_000)).resolves.toBe(false);
    await expect(service.consume('b', 3, 60_000)).resolves.toBe(true);
  });

  it('assert throws a 429 once the budget is exhausted', async () => {
    const { service } = makeService();
    await service.assert('ip', 1, 60_000);
    await expect(service.assert('ip', 1, 60_000)).rejects.toBeInstanceOf(
      HttpException,
    );
    await expect(service.assert('ip', 1, 60_000)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('delegates to the shared Redis limiter with the signup message', async () => {
    const limiter = {
      consume: jest.fn().mockResolvedValue(true),
      assert: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn(),
    };
    const service = new SignupRateLimitService(limiter as any);
    await service.assert('k', 2, 1000);
    expect(limiter.assert).toHaveBeenCalledWith(
      'k',
      2,
      1000,
      'Too many signup attempts. Please try again later.',
    );
    await service.consume('k', 2, 1000);
    expect(limiter.consume).toHaveBeenCalledWith('k', 2, 1000);
  });
});
