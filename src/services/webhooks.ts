import { handleApiResponse, getBaseUrl } from '@/lib/api-helper';
import { WebhookFailure } from '@/types';

export type { WebhookFailure };

export type GetWebhookFailuresParams = {
    source?: string;
    integrationId?: string;
    orderId?: string;
    pageSize?: number;
    cursor?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: 'Open' | 'Resolved' | 'Ignored';
};

const API_BASE_URL = `${getBaseUrl()}/api`;

export async function getWebhookFailures(params: GetWebhookFailuresParams = {}) {
    const searchParams = new URLSearchParams();
    if (params.source) searchParams.set('source', params.source);
    if (params.integrationId) searchParams.set('integrationId', params.integrationId);
    if (params.orderId) searchParams.set('orderId', params.orderId);
    if (params.pageSize) searchParams.set('pageSize', params.pageSize.toString());
    if (params.cursor) searchParams.set('cursor', params.cursor);
    if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) searchParams.set('dateTo', params.dateTo);
    if (params.status) searchParams.set('status', params.status);

    const res = await fetch(`${API_BASE_URL}/webhooks/failures?${searchParams.toString()}`);
    return handleApiResponse<{ items: WebhookFailure[]; nextCursor: string | null }>(res);
}

export async function replayWebhookFailure(id: string) {
    const res = await fetch(`${API_BASE_URL}/webhooks/failures/${id}/replay`, {
        method: 'POST',
    });
    return handleApiResponse<{ success: boolean; message: string }>(res);
}
