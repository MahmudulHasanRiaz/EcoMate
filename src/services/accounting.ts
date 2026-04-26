import type { Account, AccountType, LedgerEntry, LedgerEntryPage, BalanceSheet } from '@/types';
import type { DateRange } from 'react-day-picker';
import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';

const API_BASE_URL = `${getBaseUrl()}/api`;

export async function getChartOfAccounts(): Promise<Account[]> {
    try {
        const res = await fetch(`${API_BASE_URL}/accounting/accounts`, {
            next: { revalidate: 3600, tags: ['accounting', 'accounts'] },
        });
        const data = await handleApiResponse<Account[]>(res);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('[SERVICE_ERROR:getChartOfAccounts]', error);
        return [];
    }
}

export async function createAccount(payload: { name: string; type: AccountType; group?: string | null }): Promise<Account> {
    const res = await fetch(`${API_BASE_URL}/accounting/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return handleApiResponse<Account>(res);
}

export async function updateAccount(id: string, payload: Partial<{ name: string; type: AccountType; group?: string | null }>): Promise<Account> {
    const res = await fetch(`${API_BASE_URL}/accounting/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return handleApiResponse<Account>(res);
}

export async function deleteAccount(id: string): Promise<{ id: string; deleted: boolean }> {
    const res = await fetch(`${API_BASE_URL}/accounting/accounts/${id}`, { method: 'DELETE' });
    return handleApiResponse<{ id: string; deleted: boolean }>(res);
}

export async function getLedgerEntries(
    accountId?: string,
    dateRange?: DateRange,
    cursor?: string | null,
    limit: number = 50
): Promise<LedgerEntryPage> {
    try {
        const url = new URL(`${API_BASE_URL}/accounting/ledger`);
        if (accountId) url.searchParams.set('accountId', accountId);
        if (dateRange?.from) url.searchParams.set('from', dateRange.from.toISOString());
        if (dateRange?.to) url.searchParams.set('to', dateRange.to.toISOString());
        url.searchParams.set('limit', String(limit));
        if (cursor) url.searchParams.set('cursor', cursor);

        const res = await fetch(url.toString(), {
            next: { revalidate: 120, tags: ['accounting', 'ledger', accountId ? `ledger:${accountId}` : 'ledger:all'] },
        });
        const data = await handleApiResponse<LedgerEntryPage | LedgerEntry[]>(res);
        if (Array.isArray(data)) {
            return { entries: data, nextCursor: null };
        }
        return {
            entries: Array.isArray(data?.entries) ? data.entries : [],
            nextCursor: data?.nextCursor ?? null,
        };
    } catch (error) {
        console.error('[SERVICE_ERROR:getLedgerEntries]', error);
        return { entries: [], nextCursor: null };
    }
}

export async function postJournalEntry(payload: {
    date: string;
    description: string;
    entries: Array<{ accountId: string; debit: number; credit: number }>;
}): Promise<LedgerEntry[]> {
    const res = await fetch(`${API_BASE_URL}/accounting/journal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await handleApiResponse<LedgerEntry[] | { entries: LedgerEntry[] }>(res);
    return Array.isArray(data) ? data : data.entries || [];
}

export async function getBalanceSheet(asOfDate: Date): Promise<BalanceSheet> {
    const url = new URL(`${API_BASE_URL}/accounting/balance-sheet`);
    url.searchParams.set('asOf', asOfDate.toISOString());
    const res = await fetch(url.toString(), {
        next: { revalidate: 1800, tags: ['accounting', 'reports', 'balance-sheet'] },
    });
    return handleApiResponse<BalanceSheet>(res);
}
