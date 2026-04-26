
import { Issue, IssuePriority } from '@/types';
import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';

const BASE_URL = `${getBaseUrl()}/api/issues`;

export async function getIssues(filter?: {
    page?: number;
    pageSize?: number;
    cursor?: string;
    includeTotal?: boolean;
    status?: string | string[];
    priority?: string | string[];
    assignedTo?: string;
    search?: string;
    orderId?: string;
}): Promise<{ items: Issue[]; total: number, nextCursor?: string | null }> {
    const params = new URLSearchParams();
    if (filter?.pageSize) params.set('pageSize', String(filter.pageSize));
    if (filter?.cursor) params.set('cursor', filter.cursor);
    if (filter?.includeTotal) params.set('includeTotal', 'true');

    if (filter?.status) {
        if (Array.isArray(filter.status)) filter.status.forEach(s => params.append('status', s));
        else params.set('status', filter.status);
    }
    if (filter?.priority) {
        if (Array.isArray(filter.priority)) filter.priority.forEach(p => params.append('priority', p));
        else params.set('priority', filter.priority);
    }
    if (filter?.assignedTo) params.set('assignedTo', filter.assignedTo);
    if (filter?.search) params.set('search', filter.search);
    if (filter?.orderId) params.set('orderId', filter.orderId);

    // Legacy support or if needed
    if (filter?.page) params.set('page', String(filter.page));

    const res = await fetch(`${BASE_URL}?${params.toString()}`, { cache: 'no-store' });
    return handleApiResponse(res);
}

export async function getIssueById(id: string): Promise<Issue | undefined> {
    try {
        const res = await fetch(`${BASE_URL}/${id}`, { cache: 'no-store' });
        return handleApiResponse<Issue>(res);
    } catch (error) {
        console.error('[SERVICE_ERROR:getIssueById]', error);
        return undefined;
    }
}

export async function getIssuesByOrderId(orderId: string): Promise<Issue[]> {
    try {
        const res = await fetch(`${BASE_URL}?orderId=${encodeURIComponent(orderId)}&pageSize=100`, { cache: 'no-store' });
        const result = await handleApiResponse<{ items: Issue[] }>(res);
        return result.items;
    } catch (error) {
        console.error('[SERVICE_ERROR:getIssuesByOrderId]', error);
        return [];
    }
}

export async function createIssue(orderId: string | undefined, title: string, description: string, priority: IssuePriority, createdBy?: string): Promise<Issue> {
    const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, title, description, priority, createdBy }),
    });

    return handleApiResponse<Issue>(res);
}

export async function updateIssue(id: string, update: Partial<Issue> & { comment?: string }): Promise<Issue | undefined> {
    const res = await fetch(`${BASE_URL}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
    });

    return handleApiResponse<Issue>(res);
}
