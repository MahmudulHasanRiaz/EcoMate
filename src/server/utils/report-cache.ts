import { getRedisClient } from '@/server/queues/redis';
import { getLoadShedFlags } from './load-shed';

const CACHE_TTL_MS = 120 * 1000;
const mem = new Map<string, { expires: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Short-TTL cache for heavy report/stats data.
 * TTL defaults to 120s (2 min).
 * Features stampede guard (in-flight coalescing + Redis lock) and TTL jitter.
 */
export async function getReportCache<T>(key: string, loader: () => Promise<T>, ttlMs: number = CACHE_TTL_MS): Promise<T> {
    const flags = await getLoadShedFlags();
    if (flags.reports) {
        ttlMs = Math.max(ttlMs, 10 * 60 * 1000);
    }

    const now = Date.now();

    // 1. Memory Check
    const cached = mem.get(key);
    if (cached && cached.expires > now) {
        return cached.data as T;
    } else if (cached) {
        mem.delete(key);
    }

    // 2. In-flight coalescing (same process)
    const existingWork = inflight.get(key);
    if (existingWork) return existingWork as Promise<T>;

    // 3. Define the fetch/load logic
    const work = (async () => {
        const redis = getRedisClient();

        // Check Redis first
        if (redis) {
            try {
                const raw = await redis.get(key);
                if (raw) {
                    const parsed = JSON.parse(raw) as T;
                    mem.set(key, { expires: Date.now() + ttlMs, data: parsed });
                    return parsed;
                }
            } catch (err) {
                console.warn('[REPORT_CACHE_REDIS_READ_FAIL]', err);
            }
        }

        // Lock & Compute
        const lockKey = `${key}:lock`;
        let lockAcquired = false;

        if (redis) {
            try {
                // Try to acquire lock for 15s
                const result = await redis.set(lockKey, 'locked', 'EX', 15, 'NX');
                lockAcquired = result === 'OK';

                if (!lockAcquired) {
                    // Poll for value if lock held by another process
                    for (let i = 0; i < 5; i++) {
                        await new Promise(r => setTimeout(r, 200));
                        const raw = await redis.get(key);
                        if (raw) return JSON.parse(raw) as T;
                    }
                    // Fail-open: if still no value after polling, compute without lock
                }
            } catch (err) {
                console.warn('[REPORT_CACHE_LOCK_FAIL]', err);
            }
        }

        try {
            const data = await loader();

            // apply TTL jitter (reduce by up to 10%)
            const jitter = Math.floor(ttlMs * 0.1 * Math.random());
            const effectiveTtl = ttlMs - jitter;

            mem.set(key, { expires: Date.now() + effectiveTtl, data });
            if (redis) {
                await redis.set(key, JSON.stringify(data), 'PX', effectiveTtl).catch(() => { });
            }
            return data;
        } finally {
            if (lockAcquired && redis) {
                await redis.del(lockKey).catch(() => { });
            }
        }
    })();

    inflight.set(key, work);
    try {
        return await work as T;
    } finally {
        inflight.delete(key);
    }
}
