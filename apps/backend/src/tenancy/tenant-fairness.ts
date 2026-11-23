/**
 * Per-tenant in-flight fairness for the store-order-ingest queue
 * (Phase 9 G-14) — the lightest effective guard against one tenant's
 * burst starving every other tenant on the shared FIFO queue.
 *
 * Design:
 *  - A Redis counter per (queue, tenant) counts jobs currently
 *    executing. A job that cannot acquire a slot is DELAYED (BullMQ
 *    `moveToDelayed` + `DelayedError` — see tenant-job.ts), never
 *    failed: it yields its worker slot so another tenant's job can
 *    run, then re-enters the queue ~1s later with its priority and
 *    attempt count intact.
 *  - Cap is env-tunable: `STORE_INGEST_PER_TENANT_CONCURRENCY`
 *    (default 2). 0 or negative disables the cap entirely (escape
 *    hatch for a single-tenant deployment).
 *  - Fail-OPEN by design (pricing hard ceiling: no automated system
 *    may ever stop/throttle/degrade order intake): if Redis is
 *    unreachable the limiter falls back to a per-process in-memory
 *    counter (correct on a single replica, approximate across
 *    replicas — same precedent as the rate-limit counter); if the
 *    limiter itself throws, the caller runs the job anyway.
 *  - Slot keys carry a 10-minute TTL so a crashed worker's slots
 *    decay instead of leaking the cap forever (matches the
 *    per-store lock TTL).
 *
 * PROVISIONAL NUMBERS: the default cap of 2 and the ingest worker's
 * concurrency of 5 are provisional pending the k6 load test measuring
 * `ordersService.create` cost per order (follow-up, not this phase).
 * Do not "tune" them from intuition — measure first.
 */
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

export const FAIRNESS_DEFAULT_CAP = 2;
/** Redis key prefix for in-flight counters. */
export const FAIRNESS_KEY_PREFIX = 'fairness';
/** Bounds a crashed holder's slots (matches STORE_LOCK_TTL_MS). */
export const FAIRNESS_SLOT_TTL_MS = 10 * 60_000;
/** Base defer delay for a job over the cap (see tenant-job.ts). */
export const FAIRNESS_DEFER_DELAY_MS = 1000;
/** Jitter on the defer delay so a burst does not re-enter in lockstep. */
export const FAIRNESS_DEFER_JITTER_MS = 500;

/**
 * Per-tenant ingest concurrency cap from env. `<= 0` disables the cap.
 * Read fresh on every acquire (cheap; keeps tests deterministic).
 */
export function ingestPerTenantCap(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env['STORE_INGEST_PER_TENANT_CONCURRENCY'];
  if (raw === undefined || raw === '') return FAIRNESS_DEFAULT_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n)) return FAIRNESS_DEFAULT_CAP;
  return Math.floor(n);
}

/**
 * Atomic acquire: increment only when the current count is below the
 * cap. Returns 1 when a slot was taken, 0 when the cap is reached.
 * First holder sets the TTL (a crashed holder's slots decay).
 */
const ACQUIRE_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return 0 end
local next = redis.call('INCR', KEYS[1])
if next == 1 then redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2])) end
return 1
`;

/** Release: decrement, deleting the key at/below zero (no negatives). */
const RELEASE_LUA = `
local next = redis.call('DECR', KEYS[1])
if next <= 0 then redis.call('DEL', KEYS[1]); return 0 end
return next
`;

const logger = new Logger('TenantFairnessLimiter');

export class TenantFairnessLimiter {
  private redis: Redis | null = null;
  private isRedisConnected = false;
  /** In-memory fallback — per-process, same semantics as the Redis path. */
  private readonly memory = new Map<string, number>();

  constructor(
    private readonly keyPrefix: string = FAIRNESS_KEY_PREFIX,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  private key(queueName: string, tenantId: string): string {
    return `${this.keyPrefix}:${queueName}:inflight:${tenantId}`;
  }

  private client(): Redis {
    if (!this.redis) {
      const redisUrl = this.env['REDIS_URL'] || 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
      });
      this.redis.on('connect', () => {
        this.isRedisConnected = true;
      });
      this.redis.on('error', (err) => {
        this.isRedisConnected = false;
        logger.warn(`Redis error (fairness limiter): ${err.message}`);
      });
    }
    return this.redis;
  }

  /** Test/DI hook: close the lazy client (jest otherwise hangs). */
  destroy(): void {
    this.redis?.disconnect();
    this.redis = null;
    this.isRedisConnected = false;
  }

  /**
   * Try to take one in-flight slot for (queue, tenant). True = the
   * caller may run the job and MUST call `release` in a finally.
   * False = over the cap; the caller defers the job (never fails it).
   * Never throws for Redis trouble — falls back to the in-memory
   * counter, and if even that is unavailable the caller fails open.
   */
  async tryAcquire(queueName: string, tenantId: string): Promise<boolean> {
    const cap = ingestPerTenantCap(this.env);
    if (cap <= 0) return true;
    const key = this.key(queueName, tenantId);
    if (this.isRedisConnected && this.redis) {
      try {
        const res = (await this.redis.eval(
          ACQUIRE_LUA,
          1,
          key,
          String(cap),
          String(FAIRNESS_SLOT_TTL_MS),
        )) as number;
        return res === 1;
      } catch (err: any) {
        this.isRedisConnected = false;
        logger.warn(`Redis fallback in fairness acquire: ${err.message}`);
      }
    } else {
      // First use (or Redis down): try to bring the client up — the
      // connect is async, so this attempt uses the memory path and
      // later attempts use Redis once connected.
      try {
        this.client();
      } catch {
        // Client construction never throws for connection failure
        // (ioredis connects lazily), but stay fail-open regardless.
      }
    }
    return this.memoryAcquire(key, cap);
  }

  async release(queueName: string, tenantId: string): Promise<void> {
    const key = this.key(queueName, tenantId);
    // Release from BOTH stores: the slot may have been taken from
    // either one (Redis while connected; memory while Redis was down
    // or still connecting at cold start). Both decrements clamp at
    // zero, so releasing a slot a store never held is a safe no-op —
    // while releasing from only one store would LEAK the slot in the
    // other whenever the path switched between acquire and release
    // (the memory counter has no TTL, so a leaked slot would
    // permanently shrink the effective cap on that replica).
    if (this.isRedisConnected && this.redis) {
      try {
        await this.redis.eval(RELEASE_LUA, 1, key);
      } catch (err: any) {
        this.isRedisConnected = false;
        logger.warn(`Redis fallback in fairness release: ${err.message}`);
      }
    }
    this.memoryRelease(key);
  }

  /** Current in-flight count (observability / tests; best-effort). */
  async inFlight(queueName: string, tenantId: string): Promise<number> {
    const key = this.key(queueName, tenantId);
    if (this.isRedisConnected && this.redis) {
      try {
        return Number((await this.redis.get(key)) ?? 0);
      } catch {
        // Fall through to the memory counter.
      }
    }
    return this.memory.get(key) ?? 0;
  }

  private memoryAcquire(key: string, cap: number): boolean {
    const current = this.memory.get(key) ?? 0;
    if (current >= cap) return false;
    this.memory.set(key, current + 1);
    return true;
  }

  private memoryRelease(key: string): void {
    const current = this.memory.get(key) ?? 0;
    if (current <= 1) this.memory.delete(key);
    else this.memory.set(key, current - 1);
  }
}

/**
 * Module-level singleton used by TenantWorkerHost (the base worker is
 * not an injectable with a CacheService, so the limiter owns its own
 * Redis client, created lazily on first acquire).
 *
 * Cold-start note: the very first acquire (before the lazy client
 * connects) uses the memory counter, so for a few ms after boot the
 * cap is enforced against two counters at once and a couple of extra
 * jobs may run. Bounded and self-healing (the memory slots release
 * normally); the cap is a fairness guard, not a correctness
 * invariant, so a transient overshoot is acceptable.
 */
let singleton: TenantFairnessLimiter | null = null;

export function getFairnessLimiter(): TenantFairnessLimiter {
  if (!singleton) singleton = new TenantFairnessLimiter();
  return singleton;
}

/** Test hook: drop the singleton so a fresh limiter is built. */
export function __resetFairnessLimiterForTests(): void {
  singleton?.destroy();
  singleton = null;
}
