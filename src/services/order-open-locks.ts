
import { OrderOpenLock, OrderOpenLockAcquireResult } from '@/types';
import { handleApiResponse } from '@/lib/api-helper';

const API_BASE = '/api/orders/locks';

export class OrderLockError extends Error {
    code: string;
    lock?: OrderOpenLock;
    constructor(message: string, code: string, lock?: OrderOpenLock) {
        super(message);
        this.code = code;
        this.lock = lock;
    }
}

export async function getOrderOpenLocks(orderIds: string[]): Promise<Record<string, OrderOpenLock>> {
    const ids = orderIds.filter(Boolean).join(',');
    if (!ids) return {};

    // Fail-soft: if API fails, return empty
    try {
        const res = await fetch(`${API_BASE}?ids=${ids}`);
        const data = await handleApiResponse<{ locks: Record<string, OrderOpenLock> }>(res);
        return data.locks || {};
    } catch (error) {
        console.warn('[LOCK_SERVICE] Failed to list locks', error);
        return {};
    }
}

export async function acquireOrderOpenLock(
    orderId: string,
    force = false,
    requestToken?: string
): Promise<OrderOpenLockAcquireResult> {
    const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, force, requestToken })
    });

    const json = await res.json();

    // Handle 403 Forbidden - user doesn't have update permission
    if (res.status === 403) {
        throw new OrderLockError('No permission to acquire lock', 'FORBIDDEN');
    }

    if (res.status === 409 && json.errors?.code === 'LOCKED') {
        const error = new OrderLockError(json.message || 'Order Locked', 'LOCKED', json.errors.lock);
        throw error;
    }

    if (!res.ok) {
        throw new Error(json.message || `HTTP ${res.status}`);
    }

    return json.data as OrderOpenLockAcquireResult;
}

export async function heartbeatOrderOpenLock(orderId: string, token: string): Promise<{ active: boolean }> {
    try {
        const res = await fetch(`${API_BASE}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, token })
        });

        // 409 means expired/invalid, but strict handleApiResponse checks ok
        if (res.status === 409) return { active: false };

        await handleApiResponse(res);
        return { active: true };
    } catch (error) {
        return { active: false };
    }
}

export async function releaseOrderOpenLock(orderId: string, token: string): Promise<void> {
    const payload = JSON.stringify({ orderId, token });

    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        // Best effort on unload
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(`${API_BASE}/release`, blob);
    } else {
        await fetch(`${API_BASE}/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        }).catch(() => { });
    }
}
