import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const MAX_KEYS = 5_000;

/**
 * In-memory sliding-window limiter for the public signup endpoints.
 *
 * Platform-api runs as a small control-plane service; a single instance with
 * this limiter is enough for launch, and the edge rate limit remains the first
 * line. Keys are per-IP and per-email so one attacker cannot exhaust another
 * person's budget from a different address.
 */
@Injectable()
export class SignupRateLimitService {
  private readonly hits = new Map<string, number[]>();

  consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): boolean {
    if (this.hits.size > MAX_KEYS) this.hits.clear();
    const recent = (this.hits.get(key) ?? []).filter(
      (at) => now - at < windowMs,
    );
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  assert(key: string, limit: number, windowMs: number): void {
    if (!this.consume(key, limit, windowMs)) {
      throw new HttpException(
        'Too many signup attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Test helper — never used by the service itself. */
  reset(): void {
    this.hits.clear();
  }
}
