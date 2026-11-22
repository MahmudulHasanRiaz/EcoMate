import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { getTenantContext } from '../tenancy/tenant-context';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_MEMORY_ENTRIES = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Redis key prefixes that are NOT app cache and must NEVER be deleted by a
 * cache purge. The backend shares one Redis with state that is not cache:
 * BullMQ job queues (`bull:`), the rate-limit counters (`rl:`) and the
 * login/order brute-force counters (`ratelimit:`). Deleting those would
 * drop queued jobs and reset abuse counters, so a purge deletes every
 * other key and keeps these. This is why purge uses a SCAN + protected
 * prefix list and never FLUSHDB.
 *
 * `extstore:` (Phase 9) is the external-store binding resolution cache
 * (`extstore:<storeId>` / `extstore:domain:<provider>:<domain>`). A purge
 * must never drop it: webhook intake resolves the tenant from it, and a
 * purge-time drop would 401 every in-flight webhook until the platform
 * re-resolve repopulates it.
 */
export const CACHE_PURGE_PROTECTED_REDIS_PREFIXES = [
  'bull:',
  'rl:',
  'ratelimit:',
  'extstore:',
] as const;

export function isProtectedRedisKey(key: string): boolean {
  return CACHE_PURGE_PROTECTED_REDIS_PREFIXES.some((prefix) =>
    key.startsWith(prefix),
  );
}

export interface ClearAllResult {
  memoryCleared: number;
  redisDeleted: number;
  redisSkipped: number;
  redisAvailable: boolean;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private store = new Map<string, CacheEntry<any>>();
  private defaultTtl = 300_000;
  private redis: Redis | null = null;
  private readonly sharedConfigured =
    Boolean(process.env['REDIS_URL']) || Boolean(process.env['REDIS_HOST']);
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const redisUrl = process.env['REDIS_URL'];
    const host = process.env['REDIS_HOST'];
    if (host || redisUrl) {
      const sharedOptions = {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => Math.min(times * 100, 3000),
      };
      // Passing REDIS_URL directly preserves ACL usernames, TLS, and the
      // selected Redis database path (for example redis://user:pass@host/2).
      try {
        this.redis =
          !host && redisUrl
            ? new Redis(redisUrl, sharedOptions)
            : new Redis({
                host: host!,
                port: Number(process.env['REDIS_PORT']) || 6379,
                password: process.env['REDIS_PASSWORD'] || undefined,
                ...sharedOptions,
              });
      } catch {
        this.redis = null;
        console.warn(
          '[Cache] Invalid Redis configuration — using memory fallback',
        );
      }
      if (!this.redis) {
        this.startCleanupTimer();
        return;
      }
      this.redis.connect().catch(() => {
        this.redis = null;
        console.warn('[Cache] Redis unavailable — using memory fallback');
      });
    }
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      () => this.evictExpired(),
      CLEANUP_INTERVAL_MS,
    );
  }

  onModuleDestroy() {
    this.redis?.disconnect();
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /**
   * True when the shared Redis is reachable. False when Redis is
   * unconfigured (memory fallback) or down. Used by the readiness probe —
   * never throws, and never waits on the retry loop: a single PING with
   * the caller's own timeout decides.
   */
  async ping(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  /**
   * Every app-side cache entry is namespaced by the current tenant:
   * `t:<tenantId>:<key>`. CacheService is shared by all tenants in one
   * process/Redis, and services use plain keys (`categories:tree`,
   * `product:<id>`, analytics ranges); without this prefix the first tenant to
   * warm a key would serve its data to every other host.
   *
   * Calls without a tenant context (boot, global infra keys such as
   * `system:backup-maintenance`, protected ops) keep the raw key — production
   * API routes cannot reach them without a resolved tenant (TenantGuard).
   */
  private scopedKey(key: string): string {
    const tenantId = getTenantContext()?.tenantId;
    return tenantId ? `t:${tenantId}:${key}` : key;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const scoped = this.scopedKey(key);
    if (this.redis) {
      try {
        const raw = await this.redis.get(scoped);
        if (raw) return JSON.parse(raw) as T;
      } catch {
        /* fall through to memory */
      }
    }
    const entry = this.store.get(scoped);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(scoped);
      return undefined;
    }
    return entry.data as T;
  }

  async getStale<T>(key: string): Promise<T | undefined> {
    const scoped = this.scopedKey(key);
    if (this.redis) {
      try {
        const raw = await this.redis.get(scoped);
        if (raw) return JSON.parse(raw) as T;
      } catch {
        /* fall through to memory */
      }
    }
    const entry = this.store.get(scoped);
    if (!entry) return undefined;
    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttlMs?: number): Promise<void> {
    const scoped = this.scopedKey(key);
    const effectiveTtl = ttlMs ?? this.defaultTtl;
    // Always keep a local mirror. If Redis disappears while a destructive
    // restore is running, the owning API process must not fail open.
    if (this.store.size >= MAX_MEMORY_ENTRIES) {
      this.evictExpired();
      if (this.store.size >= MAX_MEMORY_ENTRIES) {
        const eldest = this.store.keys().next().value;
        if (eldest) this.store.delete(eldest);
      }
    }
    this.store.set(scoped, {
      data,
      expiresAt: Date.now() + effectiveTtl,
    });

    const ttlSeconds = ttlMs
      ? Math.ceil(ttlMs / 1000)
      : Math.ceil(this.defaultTtl / 1000);
    if (this.redis) {
      try {
        await this.redis.setex(scoped, ttlSeconds, JSON.stringify(data));
        return;
      } catch {
        /* fall through to memory */
      }
    }
  }

  isSharedAvailable(): boolean {
    return this.redis?.status === 'ready';
  }

  async delete(key: string): Promise<void> {
    const scoped = this.scopedKey(key);
    if (this.redis) {
      try {
        await this.redis.del(scoped);
      } catch {
        /* ignore */
      }
    }
    this.store.delete(scoped);
  }

  /**
   * Unscoped (global) get/set/delete — the key is used EXACTLY as given,
   * with no tenant prefix. For state that exists before any tenant is
   * known: the Phase 9 external-store resolver cache (`extstore:*`) runs
   * without a tenant context (webhook intake resolves the tenant FROM
   * it), so a scoped write would mis-key under whatever context happened
   * to be ambient. Never use these for tenant-owned data.
   */
  async getGlobal<T>(key: string): Promise<T | undefined> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw) return JSON.parse(raw) as T;
      } catch {
        /* fall through to memory */
      }
    }
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  async setGlobal<T>(key: string, data: T, ttlMs?: number): Promise<void> {
    const effectiveTtl = ttlMs ?? this.defaultTtl;
    if (this.store.size >= MAX_MEMORY_ENTRIES) {
      this.evictExpired();
      if (this.store.size >= MAX_MEMORY_ENTRIES) {
        const eldest = this.store.keys().next().value;
        if (eldest) this.store.delete(eldest);
      }
    }
    this.store.set(key, { data, expiresAt: Date.now() + effectiveTtl });
    if (this.redis) {
      try {
        await this.redis.setex(
          key,
          Math.ceil(effectiveTtl / 1000),
          JSON.stringify(data),
        );
      } catch {
        /* fall through to memory */
      }
    }
  }

  async deleteGlobal(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch {
        /* ignore */
      }
    }
    this.store.delete(key);
  }

  /**
   * Distributed lock (Phase 9 per-store sync serialization). `SET NX PX`
   * on Redis; the returned token MUST be passed to `releaseLock` — the
   * release is a Lua compare-and-delete so a lock can only be released
   * by its holder (an expired-then-reacquired lock is never stolen by a
   * stale holder's finally block).
   *
   * Returns the token on acquisition, `null` when the lock is held. The
   * caller decides whether to wait-and-retry or fail. Without Redis the
   * lock degrades to the in-memory mirror (single-process only) — the
   * sync workers that use it cannot run without Redis anyway (BullMQ),
   * so this only ever matters in unit/dev contexts.
   */
  async acquireLock(
    key: string,
    ttlMs: number,
    token?: string,
  ): Promise<string | null> {
    const scoped = this.scopedKey(key);
    const holder = token ?? `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    if (this.redis) {
      try {
        const res = await this.redis.set(scoped, holder, 'PX', ttlMs, 'NX');
        return res === 'OK' ? holder : null;
      } catch {
        /* fall through to memory */
      }
    }
    const existing = this.store.get(scoped);
    if (existing && Date.now() <= existing.expiresAt) return null;
    this.store.set(scoped, { data: holder, expiresAt: Date.now() + ttlMs });
    return holder;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    const scoped = this.scopedKey(key);
    if (this.redis) {
      try {
        const released = await this.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          scoped,
          token,
        );
        if (released === 1) {
          this.store.delete(scoped);
          return true;
        }
        return false;
      } catch {
        /* fall through to memory */
      }
    }
    const existing = this.store.get(scoped);
    if (existing?.data === token) {
      this.store.delete(scoped);
      return true;
    }
    return false;
  }

  async invalidateByPrefix(prefix: string): Promise<void> {
    const scoped = this.scopedKey(prefix);
    if (this.redis) {
      try {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            `${scoped}*`,
            'COUNT',
            100,
          );
          if (keys.length) await this.redis.del(...keys);
          cursor = nextCursor;
        } while (cursor !== '0');
      } catch {
        /* fall through to memory */
      }
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(scoped)) this.store.delete(key);
    }
  }

  async countByPrefix(
    prefix: string,
    options: { requireShared?: boolean } = {},
  ): Promise<number> {
    const scoped = this.scopedKey(prefix);
    this.evictExpired();
    const keys = new Set(
      [...this.store.keys()].filter((key) => key.startsWith(scoped)),
    );

    if (this.redis?.status === 'ready') {
      try {
        let cursor = '0';
        do {
          const [nextCursor, page] = await this.redis.scan(
            cursor,
            'MATCH',
            `${scoped}*`,
            'COUNT',
            100,
          );
          for (const key of page) keys.add(key);
          cursor = nextCursor;
        } while (cursor !== '0');
      } catch (error) {
        if (options.requireShared) throw error;
      }
    } else if (options.requireShared && this.sharedConfigured) {
      throw new Error(
        'Shared cache is unavailable while checking active writes',
      );
    }

    return keys.size;
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Purge ALL app cache: the in-memory mirror AND the shared Redis copy.
   *
   * The old `clear()` only emptied the in-memory mirror, so Redis entries
   * — the copy the whole backend actually reads — survived a "clear".
   * `clearAll()` closes that gap. It never touches protected Redis keys
   * (BullMQ jobs, rate-limit and brute-force counters — see
   * CACHE_PURGE_PROTECTED_REDIS_PREFIXES) and never FLUSHDBs. A Redis
   * failure does not throw: memory is still cleared and the result
   * reports `redisAvailable: false` so the caller can say so honestly.
   */
  async clearAll(): Promise<ClearAllResult> {
    const tenantId = getTenantContext()?.tenantId;
    const tenantPrefix = tenantId ? `t:${tenantId}:` : null;

    let memoryCleared = 0;
    if (tenantPrefix) {
      for (const key of [...this.store.keys()]) {
        if (key.startsWith(tenantPrefix)) {
          this.store.delete(key);
          memoryCleared++;
        }
      }
    } else {
      memoryCleared = this.store.size;
      this.store.clear();
    }

    let redisDeleted = 0;
    let redisSkipped = 0;
    let redisAvailable = false;
    if (this.redis) {
      try {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            tenantPrefix ? `${tenantPrefix}*` : '*',
            'COUNT',
            100,
          );
          const deletable = keys.filter(
            (key) => !isProtectedRedisKey(key),
          );
          redisSkipped += keys.length - deletable.length;
          if (deletable.length) {
            await this.redis.del(...deletable);
            redisDeleted += deletable.length;
          }
          cursor = nextCursor;
        } while (cursor !== '0');
        redisAvailable = true;
      } catch {
        redisAvailable = false;
      }
    }
    return { memoryCleared, redisDeleted, redisSkipped, redisAvailable };
  }
}
