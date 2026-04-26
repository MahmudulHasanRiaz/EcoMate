import prisma from '@/lib/prisma';

type WebhookFailureInput = {
    source: string;
    integrationId?: string | null;
    orderId?: string | null;
    externalOrderId?: string | null;
    payload?: unknown;
    error: unknown;
};

function normalizePayload(payload: unknown) {
    if (payload === undefined) return undefined;
    if (typeof payload === 'string') return { raw: payload };
    if (typeof payload === 'object' && payload !== null) return payload;
    return { value: payload };
}

function normalizeError(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return 'Unknown error';
    }
}

export async function recordWebhookFailure(input: WebhookFailureInput) {
    try {
        const errorMsg = normalizeError(input.error);
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        // De-dupe: Find an OPEN failure with same source/intg/order/error in last 10 mins
        const existing = await prisma.webhookFailure.findFirst({
            where: {
                source: input.source,
                integrationId: input.integrationId || null,
                orderId: input.orderId || null,
                externalOrderId: input.externalOrderId || null,
                error: errorMsg,
                status: 'Open',
                lastSeenAt: { gte: tenMinutesAgo }
            },
            orderBy: { lastSeenAt: 'desc' }
        });

        if (existing) {
            return await prisma.webhookFailure.update({
                where: { id: existing.id },
                data: {
                    lastSeenAt: new Date(),
                    occurrences: { increment: 1 }
                }
            });
        }

        return await prisma.webhookFailure.create({
            data: {
                source: input.source,
                integrationId: input.integrationId || undefined,
                orderId: input.orderId || undefined,
                externalOrderId: input.externalOrderId || undefined,
                payload: normalizePayload(input.payload),
                error: errorMsg,
                status: 'Open',
                firstSeenAt: new Date(),
                lastSeenAt: new Date(),
                occurrences: 1,
            },
        });
    } catch (err) {
        console.error('[WEBHOOK_FAILURE_STORE_ERROR]', err);
    }
}

export async function resolveWebhookFailures(integrationId: string, orderId?: string | null) {
    try {
        await prisma.webhookFailure.updateMany({
            where: {
                integrationId,
                orderId: orderId || undefined,
                status: 'Open',
            },
            data: {
                status: 'Resolved',
                resolvedAt: new Date(),
                resolvedNote: 'Auto-resolved by successful delivery'
            }
        });
    } catch (err) {
        console.error('[WEBHOOK_FAILURE_RESOLVE_ERROR]', err);
    }
}
export async function getWebhookFailures(params: {
    source?: string;
    integrationId?: string;
    orderId?: string;
    status?: 'Open' | 'Resolved' | 'Ignored' | 'all';
    pageSize?: number;
    cursor?: string;
    dateFrom?: Date;
    dateTo?: Date;
}) {
    const pageSize = params.pageSize || 20;

    const where: any = {};
    if (params.source) where.source = params.source;
    if (params.integrationId) where.integrationId = params.integrationId;
    if (params.orderId) where.orderId = params.orderId;

    if (params.status && params.status !== 'all') {
        where.status = params.status;
    } else if (!params.status) {
        where.status = 'Open';
    }

    if (params.dateFrom || params.dateTo) {
        where.createdAt = {};
        if (params.dateFrom) where.createdAt.gte = params.dateFrom;
        if (params.dateTo) where.createdAt.lte = params.dateTo;
    }

    const items = await prisma.webhookFailure.findMany({
        where,
        take: pageSize + 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        cursor: params.cursor ? { id: params.cursor } : undefined,
        select: {
            id: true,
            source: true,
            integrationId: true,
            orderId: true,
            externalOrderId: true,
            createdAt: true,
            error: true,
            status: true,
            occurrences: true,
            lastSeenAt: true,
            resolvedAt: true,
            // Exclude payload for performance/security in list view
        },
    });

    let nextCursor: string | null = null;
    if (items.length > pageSize) {
        const last = items.pop();
        nextCursor = last?.id || null;
    }

    return { items, nextCursor };
}

export async function getWebhookFailureById(id: string) {
    return prisma.webhookFailure.findUnique({
        where: { id },
    });
}
