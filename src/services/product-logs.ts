'use server';

import prisma from '@/lib/prisma';
import type { ProductLog } from '@/types';

export type PaginatedLogs = {
    items: ProductLog[];
    total: number;
    pageSize: number;
    nextCursor?: string | null;
    hasMore?: boolean;
};

export async function getProductLogs(productId: string, params?: { pageSize?: number; cursor?: string; includeTotal?: boolean }): Promise<PaginatedLogs> {
    try {
        const pageSize = Math.min(params?.pageSize && params.pageSize > 0 ? params.pageSize : 10, 100);
        const cursor = params?.cursor;

        const [logs, total] = await Promise.all([
            prisma.productLog.findMany({
                where: { productId },
                orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
                cursor: cursor ? { id: cursor } : undefined,
                take: pageSize + 1,
                include: { product: { select: { name: true } } }
            }),
            params?.includeTotal ? prisma.productLog.count({ where: { productId } }) : Promise.resolve(0),
        ]);

        const hasMore = logs.length > pageSize;
        const resultLogs = hasMore ? logs.slice(0, pageSize) : logs;
        let nextCursor: string | null = null;
        if (hasMore) {
            nextCursor = resultLogs[resultLogs.length - 1].id;
        }

        const mappedLogs: ProductLog[] = resultLogs.map(l => ({
            id: l.id,
            productId: l.productId,
            action: l.action,
            details: l.details || undefined,
            user: l.user,
            timestamp: l.timestamp.toISOString(),
        }));

        return { items: mappedLogs, total, pageSize, nextCursor, hasMore };
    } catch (error) {
        console.error('[SERVICE_ERROR:getProductLogs]', error);
        return { items: [], total: 0, pageSize: 10, hasMore: false, nextCursor: null };
    }
}
