const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window
const DEFAULT_LIMIT = 60; // requests per window
const CLEANUP_INTERVAL_MS = 10 * 60_000; // 10 minutes

const inMemoryMap = new Map<string, { count: number; resetAt: number }>();

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of inMemoryMap.entries()) {
    if (now >= entry.resetAt) inMemoryMap.delete(key);
  }
}
setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS).unref();

async function getRedis() {
  try {
    const { getRedisClient } = await import("@/server/queues/redis");
    return getRedisClient();
  } catch {
    return null;
  }
}

export function getRateLimitHeaders(remaining: number, limit: number, resetAt: number) {
  return {
    "X-RateLimit-Remaining": String(Math.max(0, remaining)),
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
  };
}

export async function checkRateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const redis = await getRedis();

  if (redis) {
    const redisKey = `ratelimit:v1:${key}`;
    try {
      const current = await redis.get(redisKey);
      if (!current) {
        await redis.set(redisKey, "1", "PX", RATE_LIMIT_WINDOW_MS);
        return { allowed: true, remaining: limit - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
      }
      const count = parseInt(current);
      if (count >= limit) {
        const ttl = await redis.pttl(redisKey);
        return { allowed: false, remaining: 0, resetAt: now + (ttl > 0 ? ttl : RATE_LIMIT_WINDOW_MS) };
      }
      await redis.incr(redisKey);
      return { allowed: true, remaining: limit - count - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    } catch {
      // fall through to in-memory
    }
  }

  // In-memory fallback
  const entry = inMemoryMap.get(key);
  if (!entry || now >= entry.resetAt) {
    inMemoryMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: limit - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }
  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}
