import { Injectable } from '@nestjs/common';
import { RedisRateLimitService } from '../common/rate-limit/redis-rate-limit.service';

/**
 * Sliding-window limiter for the public signup endpoints, backed by the
 * shared Redis rate limiter (with an in-memory fallback when Redis is
 * unreachable). Replaces the previous per-instance in-memory Map: two
 * platform-api replicas no longer double the effective budget, and a
 * restart no longer wipes the counters.
 *
 * Keys are per-IP and per-email so one attacker cannot exhaust another
 * person's budget from a different address.
 */
@Injectable()
export class SignupRateLimitService {
  constructor(private readonly limiter: RedisRateLimitService) {}

  consume(key: string, limit: number, windowMs: number): Promise<boolean> {
    return this.limiter.consume(key, limit, windowMs);
  }

  assert(key: string, limit: number, windowMs: number): Promise<void> {
    return this.limiter.assert(
      key,
      limit,
      windowMs,
      'Too many signup attempts. Please try again later.',
    );
  }

  /** Test helper — clears the in-memory fallback only, never Redis. */
  reset(): void {
    this.limiter.reset();
  }
}
