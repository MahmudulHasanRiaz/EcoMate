import { getRedisClient } from '@/server/queues/redis';
import crypto from 'crypto';

const BATCH_PREFIX = 'print:batch:';
const DEFAULT_TTL = 60 * 30; // 30 minutes

/**
 * Creates a print batch in Redis and returns a unique token.
 */
export async function createPrintBatch(ids: string[]): Promise<string> {
    const redis = getRedisClient();
    if (!redis) {
        throw new Error('Redis is not configured. Bulk print tokenization unavailable.');
    }

    const token = crypto.randomBytes(16).toString('hex');
    const key = `${BATCH_PREFIX}${token}`;

    await redis.set(key, JSON.stringify(ids), 'EX', DEFAULT_TTL);
    return token;
}

/**
 * Retrieves order IDs for a given print batch token.
 */
export async function getPrintBatch(token: string): Promise<string[] | null> {
    const redis = getRedisClient();
    if (!redis) {
        console.error('[PRINT_BATCH] Redis not configured during retrieval');
        return null;
    }

    const key = `${BATCH_PREFIX}${token}`;
    const data = await redis.get(key);

    if (!data) return null;

    try {
        return JSON.parse(data);
    } catch (err) {
        console.error('[PRINT_BATCH] Parse error for token:', token, err);
        return null;
    }
}
