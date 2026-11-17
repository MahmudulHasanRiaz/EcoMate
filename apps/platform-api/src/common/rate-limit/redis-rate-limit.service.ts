import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';

/**
 * Injection token for a caller-owned Redis client. Nothing provides it in
 * production — the service is `@Optional()`, so Nest passes `undefined` and
 * the service connects to `REDIS_URL` itself. Tests pass a fake directly
 * (or `'memory'`) via the constructor, bypassing Nest DI.
 */
export const REDIS_RATE_LIMIT_CLIENT = 'REDIS_RATE_LIMIT_CLIENT';

/**
 * Minimal Redis surface the limiter needs — small enough that tests can
 * inject an in-memory fake instead of a live server.
 */
export interface RateLimitRedisClient {
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  zcard(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

/**
 * Sliding-window rate limiter backed by Redis (sorted sets), with an
 * in-memory fallback when Redis is unreachable — same posture as the backend
 * RateLimitCounterService: warn loudly, keep serving, single-instance only
 * while the fallback is in use.
 *
 * Keys are namespaced `rl:platform:<key>` so platform-api counters never
 * collide with the backend's `rl:<tenant>:…` keys on a shared Redis.
 */
@Injectable()
export class RedisRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimitService.name);
  private readonly redis: RateLimitRedisClient | null;
  private readonly ownedRedis: Redis | null;
  private redisAvailable: boolean;
  private readonly memory = new Map<string, number[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param client An injected Redis client (tests / caller-owned
   * connection), or `'memory'` to force the in-memory fallback with no
   * Redis connection attempt. With no argument the service connects to
   * `REDIS_URL` (default `redis://127.0.0.1:6379`).
   */
  constructor(
    @Optional()
    @Inject(REDIS_RATE_LIMIT_CLIENT)
    client?: RateLimitRedisClient | 'memory',
  ) {
    if (client === 'memory') {
      this.redis = null;
      this.ownedRedis = null;
      this.redisAvailable = false;
      return;
    }
    if (client) {
      // Test-injected client (or a caller-owned connection): never closed here.
      this.redis = client;
      this.ownedRedis = null;
      this.redisAvailable = true;
      return;
    }
    let owned: Redis | null = null;
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    try {
      owned = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
        lazyConnect: true,
      });
      owned.on('connect', () => {
        this.redisAvailable = true;
      });
      owned.on('error', (err) => {
        if (this.redisAvailable) {
          this.logger.warn(
            `Redis error (platform rate limiter): ${err.message} — falling back to in-memory`,
          );
        }
        this.redisAvailable = false;
      });
      void owned.connect().catch(() => {
        this.redisAvailable = false;
      });
    } catch {
      this.logger.warn(
        'Redis unavailable for platform rate limiter, using in-memory fallback',
      );
    }
    this.redis = owned;
    this.ownedRedis = owned;
    this.redisAvailable = !!owned;
    this.cleanupTimer = setInterval(() => this.cleanupMemory(), 60_000);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.ownedRedis?.disconnect();
  }

  /** True when counters are stored in Redis (shared across instances). */
  isRedisBacked(): boolean {
    return this.redisAvailable && !!this.redis;
  }

  private namespaced(key: string): string {
    return `rl:platform:${key}`;
  }

  /**
   * Consume one unit of `key`'s budget. Returns false when the sliding
   * window already holds `limit` hits (the hit is NOT recorded then).
   */
  async consume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    if (this.isRedisBacked()) {
      try {
        return await this.redisConsume(key, limit, windowMs);
      } catch (err) {
        this.logger.warn(
          `Redis rate-limit consume failed, using in-memory fallback: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.redisAvailable = false;
      }
    }
    return this.memoryConsume(key, limit, windowMs);
  }

  private async redisConsume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    const redisKey = this.namespaced(key);
    const now = Date.now();
    const floor = now - windowMs;
    await this.redis!.zremrangebyscore(redisKey, 0, floor);
    const count = await this.redis!.zcard(redisKey);
    if (count >= limit) return false;
    await this.redis!.zadd(
      redisKey,
      now,
      `${now}:${randomBytes(8).toString('hex')}`,
    );
    await this.redis!.expire(redisKey, Math.ceil(windowMs / 1000) + 1);
    return true;
  }

  private memoryConsume(
    key: string,
    limit: number,
    windowMs: number,
  ): boolean {
    const now = Date.now();
    const recent = (this.memory.get(key) ?? []).filter(
      (at) => now - at < windowMs,
    );
    if (recent.length >= limit) {
      this.memory.set(key, recent);
      return false;
    }
    recent.push(now);
    this.memory.set(key, recent);
    return true;
  }

  /** Like consume(), but throws 429 when the budget is exhausted. */
  async assert(
    key: string,
    limit: number,
    windowMs: number,
    message = 'Too many requests. Please try again later.',
  ): Promise<void> {
    if (!(await this.consume(key, limit, windowMs))) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private cleanupMemory(): void {
    // Entries are pruned lazily on consume; this sweep only bounds the map
    // for keys that stopped receiving traffic (keeps the 60s timer honest).
    const now = Date.now();
    for (const [key, hits] of this.memory) {
      const recent = hits.filter((at) => now - at < 60 * 60_000);
      if (recent.length === 0) this.memory.delete(key);
      else this.memory.set(key, recent);
    }
  }

  /** Test helper — clears the in-memory fallback only, never Redis. */
  reset(): void {
    this.memory.clear();
  }
}
