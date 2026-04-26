import { getQueue } from './index';

export type CourierSyncPayload = {
    orderIds: string[];
    user?: string;
};

export async function enqueueCourierSyncJob(payload: CourierSyncPayload) {
    const queue = getQueue('courier-ops');
    if (!queue) return { queued: false };

    await queue.add('sync-pathao-status', payload, {
        removeOnComplete: 100,
        removeOnFail: 500,
    });
    return { queued: true };
}
