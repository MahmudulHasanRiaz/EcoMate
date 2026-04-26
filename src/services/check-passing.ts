import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';
import type { CheckStatus } from '@/types';

export type CheckPassingItem = {
  id: string;
  date: string;
  amount: number;
  status: CheckStatus;
  source: 'Purchase' | 'Expense' | 'Staff';
  referenceId: string;
  referenceLabel: string;
  referenceUrl: string;
  payee: string;
  type: string;
  checkNo?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CheckPassingPage = {
  items: CheckPassingItem[];
  nextCursor: string | null;
};

export type CheckPassingSummaryItem = {
  date: string;
  count: number;
  total: number;
};

export type CheckPassingLog = {
  id: string;
  source: 'Purchase' | 'Expense' | 'Staff';
  sourceId: string;
  previousStatus: CheckStatus | null;
  newStatus: CheckStatus;
  note?: string | null;
  userName: string;
  userId?: string | null;
  createdAt: string;
};

const API_BASE_URL = `${getBaseUrl()}/api`;

export async function getCheckPassingItems(params?: {
  pageSize?: number;
  cursor?: string | null;
  from?: string | Date;
  to?: string | Date;
  status?: CheckStatus | 'All' | null;
  source?: CheckPassingItem['source'] | 'All' | null;
  search?: string;
}): Promise<CheckPassingPage> {
  try {
    const url = new URL(`${API_BASE_URL}/check-passing`);
    if (params?.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
    if (params?.cursor) url.searchParams.set('cursor', params.cursor);
    if (params?.from) {
      const value = params.from instanceof Date ? params.from.toISOString() : params.from;
      url.searchParams.set('from', value);
    }
    if (params?.to) {
      const value = params.to instanceof Date ? params.to.toISOString() : params.to;
      url.searchParams.set('to', value);
    }
    if (params?.status && params.status !== 'All') url.searchParams.set('status', params.status);
    if (params?.source && params.source !== 'All') url.searchParams.set('source', params.source);
    if (params?.search) url.searchParams.set('search', params.search);

    const res = await fetch(url.toString(), {
      cache: 'no-store',
    });
    const data = await handleApiResponse<CheckPassingPage>(res);
    return {
      items: Array.isArray(data?.items) ? data.items : [],
      nextCursor: data?.nextCursor ?? null,
    };
  } catch (error) {
    console.error('[SERVICE_ERROR:getCheckPassingItems]', error);
    return { items: [], nextCursor: null };
  }
}

export async function updateCheckPassingStatus(
  updates: Array<{
    id: string;
    source: CheckPassingItem['source'];
    status: CheckStatus;
    note?: string;
  }>
): Promise<{ updated: Array<{ id: string; source: CheckPassingItem['source']; status: CheckStatus; updatedAt?: string }> }> {
  try {
    const res = await fetch(`${API_BASE_URL}/check-passing`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    return await handleApiResponse<{ updated: Array<{ id: string; source: CheckPassingItem['source']; status: CheckStatus; updatedAt?: string }> }>(res);
  } catch (error) {
    console.error('[SERVICE_ERROR:updateCheckPassingStatus]', error);
    return { updated: [] };
  }
}

export async function getCheckPassingSummary(): Promise<CheckPassingSummaryItem[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/check-passing/summary`, {
      cache: 'no-store',
    });
    const data = await handleApiResponse<CheckPassingSummaryItem[]>(res);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[SERVICE_ERROR:getCheckPassingSummary]', error);
    return [];
  }
}

export async function getCheckPassingLogs(params: {
  source: CheckPassingItem['source'];
  sourceId: string;
}): Promise<CheckPassingLog[]> {
  try {
    const url = new URL(`${API_BASE_URL}/check-passing/logs`);
    url.searchParams.set('source', params.source);
    url.searchParams.set('sourceId', params.sourceId);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    const data = await handleApiResponse<CheckPassingLog[]>(res);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[SERVICE_ERROR:getCheckPassingLogs]', error);
    return [];
  }
}
