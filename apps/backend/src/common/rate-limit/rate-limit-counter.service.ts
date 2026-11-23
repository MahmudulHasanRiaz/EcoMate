import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

interface CounterEntry {
  count: number;
  firstHit: number;
}

interface BucketEntry {
  tokens: number;
  /** ms timestamp of the last refill calculation. */
  ts: number;
}

/**
 * Atomic token-bucket consume (Redis). The bucket is a hash
 * `{ tokens, ts }`; refill is continuous (elapsed × rate), capped at
 * capacity. Returns [allowed (1/0), tokens remaining, resetMs].
 *
 * ARGV: 1 = capacity, 2 = refill tokens per ms, 3 = now (ms),
 * 4 = key TTL (ms — time to refill from empty + margin, so idle
 * buckets disappear instead of accumulating forever).
 */
const TOKEN_BUCKET_LUA = `
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
local now = tonumber(ARGV[3])
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
if tokens == nil then tokens = capacity; ts = now end
local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * refillPerMs)
local allowed = 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]))
local resetMs = 0
if allowed == 0 then resetMs = math.ceil((1 - tokens) / refillPerMs) end
return {allowed, tokens, resetMs}
`;

@Injectable()
export class RateLimitCounterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitCounterService.name);
  private redis: Redis | null = null;
  private isRedisConnected = false;
  private inMemory = new Map<string, CounterEntry>();
  private inMemoryBuckets = new Map<string, BucketEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
      });
      this.redis.on('connect', () => { this.isRedisConnected = true; });
      this.redis.on('error', (err) => {
        this.isRedisConnected = false;
        this.logger.warn(`Redis error (rate-limit counter): ${err.message}`);
      });
    } catch {
      this.logger.warn('Redis unavailable for rate-limit counter, using in-memory');
    }

    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);

    // Log deployment mode on construction
    if (this.isRedisConnected) {
      this.logger.log('Rate-limit counter: Redis connected');
    } else {
      this.logger.warn(
        'Rate-limit counter: Redis unavailable — using in-memory fallback. '
        + 'Single-instance OK for dev. Multi-instance deployments REQUIRE Redis '
        + 'for correct rate limiting across replicas.',
      );
    }
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
    this.redis?.disconnect();
  }

  /**
   * Build a counter key from tenant, policy, tier, and resolved identity.
   * Identity priority: userId → sessionId → browserTrust nonce → IP
   */
  buildKey(tenant: string, policy: string, tier: string, identity: string): string {
    return `rl:${tenant}:${policy}:${tier}:${identity}`;
  }

  /**
   * Increment counter and return current count + remaining info.
   */
  async increment(
    key: string,
    maxCount: number,
    windowMs: number,
  ): Promise<{ count: number; remaining: number; resetMs: number }> {
    if (this.isRedisConnected && this.redis) {
      return this.redisIncrement(key, maxCount, windowMs);
    }
    return this.memoryIncrement(key, maxCount, windowMs);
  }

  /**
   * Token-bucket consume (Phase 9 G-13): burst-tolerant limiting for the
   * store_webhook policy. The bucket starts full (`capacity` tokens, so
   * a burst up to `capacity` passes instantly) and refills continuously
   * at `refillPerMinute` tokens/minute. Returns whether this request
   * got a token, the tokens remaining, and the ms until the next token
   * is available (0 when allowed). Redis path is a single atomic Lua
   * script; the in-memory path mirrors the same math (single-instance
   * fallback, same as `increment`).
   */
  async consumeTokenBucket(
    key: string,
    capacity: number,
    refillPerMinute: number,
  ): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
    if (this.isRedisConnected && this.redis) {
      return this.redisConsumeTokenBucket(key, capacity, refillPerMinute);
    }
    return this.memoryConsumeTokenBucket(key, capacity, refillPerMinute);
  }

  private async redisConsumeTokenBucket(
    key: string,
    capacity: number,
    refillPerMinute: number,
  ): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
    try {
      const refillPerMs = refillPerMinute / 60000;
      // TTL: time to refill from empty + 60s margin (idle buckets expire).
      const ttlMs = Math.ceil(capacity / refillPerMs) + 60000;
      const result = (await this.redis!.eval(
        TOKEN_BUCKET_LUA,
        1,
        key,
        String(capacity),
        String(refillPerMs),
        String(Date.now()),
        String(ttlMs),
      )) as [number, string, number];
      const [allowed, tokens, resetMs] = result;
      return {
        allowed: allowed === 1,
        remaining: Math.max(0, Math.floor(Number(tokens))),
        resetMs: Number(resetMs),
      };
    } catch (err: any) {
      this.isRedisConnected = false;
      this.logger.warn(`Redis fallback in token bucket: ${err.message}`);
      return this.memoryConsumeTokenBucket(key, capacity, refillPerMinute);
    }
  }

  private memoryConsumeTokenBucket(
    key: string,
    capacity: number,
    refillPerMinute: number,
  ): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const refillPerMs = refillPerMinute / 60000;
    let entry = this.inMemoryBuckets.get(key);
    if (!entry) {
      entry = { tokens: capacity, ts: now };
      this.inMemoryBuckets.set(key, entry);
    }
    const elapsed = Math.max(0, now - entry.ts);
    entry.tokens = Math.min(capacity, entry.tokens + elapsed * refillPerMs);
    entry.ts = now;
    let allowed = false;
    let resetMs = 0;
    if (entry.tokens >= 1) {
      entry.tokens -= 1;
      allowed = true;
    } else {
      resetMs = Math.ceil((1 - entry.tokens) / refillPerMs);
    }
    return {
      allowed,
      remaining: Math.max(0, Math.floor(entry.tokens)),
      resetMs,
    };
  }

  private async redisIncrement(
    key: string,
    maxCount: number,
    windowMs: number,
  ): Promise<{ count: number; remaining: number; resetMs: number }> {
    try {
      const windowSec = Math.ceil(windowMs / 1000);
      const pipeline = this.redis!.pipeline();
      pipeline.incr(key);
      pipeline.ttl(key);
      const results = await pipeline.exec();
      if (!results) throw new Error('Pipeline returned null');

      const count = results[0][1] as number;
      let ttl = results[1][1] as number;

      if (count === 1 || ttl === -1) {
        await this.redis!.expire(key, windowSec);
        ttl = windowSec;
      }

      return {
        count,
        remaining: Math.max(0, maxCount - count),
        resetMs: ttl * 1000,
      };
    } catch (err: any) {
      this.isRedisConnected = false;
      this.logger.warn(`Redis fallback in counter: ${err.message}`);
      return this.memoryIncrement(key, maxCount, windowMs);
    }
  }

  private memoryIncrement(
    key: string,
    maxCount: number,
    windowMs: number,
  ): { count: number; remaining: number; resetMs: number } {
    const now = Date.now();
    let entry = this.inMemory.get(key);

    if (!entry || now - entry.firstHit > windowMs) {
      entry = { count: 0, firstHit: now };
      this.inMemory.set(key, entry);
    }

    entry.count++;
    const elapsed = now - entry.firstHit;
    const resetMs = Math.max(0, windowMs - elapsed);

    return {
      count: entry.count,
      remaining: Math.max(0, maxCount - entry.count),
      resetMs,
    };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.inMemory.entries()) {
      if (now - entry.firstHit > 120_000) {
        this.inMemory.delete(key);
      }
    }
    // Buckets refill continuously, so a stale entry is one untouched for
    // a long time; 10 minutes bounds the map without ever dropping a
    // bucket a live store is still using (its ts refreshes per consume).
    for (const [key, entry] of this.inMemoryBuckets.entries()) {
      if (now - entry.ts > 600_000) {
        this.inMemoryBuckets.delete(key);
      }
    }
  }
}
