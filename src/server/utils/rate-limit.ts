import { getRedisClient } from '@/server/queues/redis';

const inMemoryStore = new Map<string, { count: number; expiresAt: number }>();

/**
 * Checks if a key has exceeded the rate limit.
 * @param key Unique identifier (e.g. implementation:ip)
 * @param limit Max requests allowed
 * @param windowSeconds Time window in seconds
 * @returns true if allowed, false if limit exceeded
 */
export async function checkRateLimit(key: string, limit: number = 10, windowSeconds: number = 60): Promise<boolean> {
    const redis = getRedisClient();

    if (redis) {
        try {
            const redisKey = `ratelimit:${key}`;
            const current = await redis.incr(redisKey);
            if (current === 1) {
                await redis.expire(redisKey, windowSeconds);
            }
            return current <= limit;
        } catch (err) {
            console.warn('Redis rate limit error, falling back to memory', err);
        }
    }

    // Fallback: In-Memory Fixed Window
    const now = Date.now();
    const record = inMemoryStore.get(key);

    if (record && now < record.expiresAt) {
        record.count += 1;
        return record.count <= limit;
    }

    inMemoryStore.set(key, {
        count: 1,
        expiresAt: now + windowSeconds * 1000
    });

    // Cleanup old keys occasionally
    if (inMemoryStore.size > 10000) {
        for (const [k, v] of inMemoryStore.entries()) {
            if (now > v.expiresAt) inMemoryStore.delete(k);
        }
    }

    return true;
}
