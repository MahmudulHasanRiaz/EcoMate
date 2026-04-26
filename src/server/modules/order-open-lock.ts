import { getRedisClient } from '@/server/queues/redis';
import { OrderOpenLock, OrderOpenLockAcquireResult } from '@/types';
import { randomUUID } from 'crypto';

const LOCK_TTL_SEC = 75;
export const HEARTBEAT_SEC = 20;

const getLockKey = (orderId: string) => `order:open-lock:${orderId}`;

/**
 * List locks for a set of order IDs.
 * Uses mget for efficiency.
 * Returns a map of orderId -> lock.
 */
export async function listOrderOpenLocks(orderIds: string[]): Promise<Record<string, OrderOpenLock>> {
    const redis = getRedisClient();
    if (!redis || orderIds.length === 0) return {};

    try {
        const keys = orderIds.map(getLockKey);
        const values = await redis.mget(keys);

        const result: Record<string, OrderOpenLock> = {};

        values.forEach((val, idx) => {
            if (val) {
                try {
                    const lock = JSON.parse(val) as OrderOpenLock;
                    // Validate structure lightly
                    if (lock && lock.orderId && lock.token) {
                        result[orderIds[idx]] = lock;
                    }
                } catch (e) {
                    // Ignore parse errors, treat as no lock
                }
            }
        });

        return result;
    } catch (error) {
        console.error('[LOCK_MODULE] listOrderOpenLocks error:', error);
        return {}; // Fail open
    }
}

/**
 * Get current lock for a single order.
 */
export async function getCurrentOrderLock(orderId: string): Promise<OrderOpenLock | null> {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
        const val = await redis.get(getLockKey(orderId));
        if (val) {
            return JSON.parse(val) as OrderOpenLock;
        }
    } catch (e) {
        console.error('[LOCK_MODULE] getCurrentOrderLock error:', e);
    }
    return null;
}

type AcquireParams = {
    orderId: string;
    staffId: string;
    staffName: string;
    staffCode?: string | null;
    force?: boolean;
    requestToken?: string; // If re-acquiring or upgrading
};

// Lua script for atomic lock acquisition
// Returns: JSON-serialized result with structure: { status, existingLock?, newLock? }
const ACQUIRE_LOCK_SCRIPT = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local staffId = ARGV[2]
local newLockJson = ARGV[3]
local force = ARGV[4]

local existingLock = redis.call('GET', key)

if existingLock then
    local existing = cjson.decode(existingLock)
    
    -- If locked by same user, refresh (keep token and openedAt)
    if existing.staffId == staffId then
        local newLock = cjson.decode(newLockJson)
        newLock.token = existing.token
        newLock.openedAt = existing.openedAt
        newLock.lastSeenAt = newLock.lastSeenAt
        redis.call('SET', key, cjson.encode(newLock), 'EX', ttl)
        return cjson.encode({ status = 'ACQUIRED', newLock = newLock })
    end
    
    -- If locked by another user and not forcing, return locked
    if force ~= '1' then
        return cjson.encode({ status = 'LOCKED', existingLock = existing })
    end
    
    -- Force override: store existing lock info and create new
    redis.call('SET', key, newLockJson, 'EX', ttl)
    return cjson.encode({ status = 'OVERRIDDEN', previousLock = existing, newLock = cjson.decode(newLockJson) })
end

-- No existing lock, acquire
redis.call('SET', key, newLockJson, 'EX', ttl)
return cjson.encode({ status = 'ACQUIRED', newLock = cjson.decode(newLockJson) })
`;

/**
 * Acquire or refresh a lock on an order - ATOMIC VERSION using Lua script.
 */
export async function acquireOrderOpenLock(params: AcquireParams): Promise<OrderOpenLockAcquireResult> {
    const redis = getRedisClient();
    if (!redis) {
        // Fail open if Redis is down: return a fake success lock so user can proceed
        const fakeLock: OrderOpenLock = {
            orderId: params.orderId,
            token: params.requestToken || randomUUID(),
            staffId: params.staffId,
            staffName: params.staffName,
            staffCode: params.staffCode || null,
            openedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
        };
        return { success: true, acquired: true, lock: fakeLock };
    }

    const key = getLockKey(params.orderId);
    const now = new Date().toISOString();

    const newLock: Partial<OrderOpenLock> = {
        orderId: params.orderId,
        token: params.requestToken || randomUUID(),
        staffId: params.staffId,
        staffName: params.staffName,
        staffCode: params.staffCode || null,
        openedAt: now,
        lastSeenAt: now,
    };

    try {
        const result = await redis.eval(
            ACQUIRE_LOCK_SCRIPT,
            1,
            key,
            LOCK_TTL_SEC.toString(),
            params.staffId,
            JSON.stringify(newLock),
            params.force ? '1' : '0'
        ) as string;

        const parsed = JSON.parse(result);

        if (parsed.status === 'ACQUIRED') {
            return {
                success: true,
                acquired: true,
                lock: parsed.newLock as OrderOpenLock
            };
        } else if (parsed.status === 'OVERRIDDEN') {
            return {
                success: true,
                acquired: true,
                overridden: true,
                previousLock: parsed.previousLock as OrderOpenLock,
                lock: parsed.newLock as OrderOpenLock
            };
        } else if (parsed.status === 'LOCKED') {
            return {
                success: false,
                acquired: false,
                lock: parsed.existingLock as OrderOpenLock
            };
        }

        // Fallback
        throw new Error('Unexpected lock script result');

    } catch (error) {
        console.error('[LOCK_MODULE] acquireOrderOpenLock error:', error);
        // Fail open
        return {
            success: true,
            acquired: true,
            lock: {
                orderId: params.orderId,
                token: randomUUID(),
                staffId: params.staffId,
                staffName: params.staffName,
                staffCode: params.staffCode || null,
                openedAt: new Date().toISOString(),
                lastSeenAt: new Date().toISOString(),
            }
        };
    }
}

/**
 * Heartbeat to extend lock TTL.
 * Only succeeds if token matches.
 */
export async function heartbeatOrderOpenLock(params: { orderId: string, token: string, staffId: string }) {
    const redis = getRedisClient();
    if (!redis) return { success: true, active: true }; // Assume active if redis down

    const key = getLockKey(params.orderId);

    try {
        const raw = await redis.get(key);
        if (!raw) return { success: false, active: false };

        const lock = JSON.parse(raw) as OrderOpenLock;

        // precise match on token preferred, fall back to staffId unique check
        if (lock.token === params.token) {
            // Update lastSeen
            lock.lastSeenAt = new Date().toISOString();
            await redis.set(key, JSON.stringify(lock), 'EX', LOCK_TTL_SEC);
            return { success: true, active: true };
        }

        return { success: false, active: false };
    } catch (error) {
        return { success: false, active: false };
    }
}

/**
 * Release lock.
 * Only if token matches (or maybe staffId if token missing).
 */
export async function releaseOrderOpenLock(params: { orderId: string, token: string, staffId: string }) {
    const redis = getRedisClient();
    if (!redis) return;

    const key = getLockKey(params.orderId);

    try {
        const raw = await redis.get(key);
        if (!raw) return;

        const lock = JSON.parse(raw) as OrderOpenLock;
        if (lock.token === params.token) {
            await redis.del(key);
        }
    } catch (error) {
        console.error('[LOCK_MODULE] releaseOrderOpenLock error:', error);
    }
}
