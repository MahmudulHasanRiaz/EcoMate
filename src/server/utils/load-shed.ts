import { getRedisClient } from '@/server/queues/redis';

const MEM_TTL_MS = 30 * 1000;
let cache: { reports: boolean; sync: boolean; expires: number } = { reports: false, sync: false, expires: 0 };

export async function getLoadShedFlags() {
    const now = Date.now();
    if (cache.expires > now) return cache;

    const redis = getRedisClient();
    let reports = false;
    let sync = false;
    if (redis) {
        try {
            const [r, s] = await Promise.all([
                redis.get('load-shed:reports'),
                redis.get('load-shed:sync'),
            ]);
            reports = r === '1';
            sync = s === '1';
        } catch {
            // fallback to false
        }
    }
    cache = { reports, sync, expires: now + MEM_TTL_MS };
    return cache;
}
