
import { Expense, ExpenseCategory } from '@/types';
import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';

const BASE_URL = `${getBaseUrl()}/api/expenses`;

export type ExpenseListParams = {
    categoryId?: string;
    businessId?: string;
    branchId?: string;
    branchIds?: string[];
    from?: string;
    to?: string;
    isAdExpense?: boolean;
    platform?: string;
    cursor?: string;
    pageSize?: number;
    search?: string;
    includeTotal?: boolean;
};

export type ExpensesPage = {
    items: Expense[];
    total: number;
    pageSize: number;
    nextCursor?: string | null;
    hasMore?: boolean;
    summary?: {
        totalAmount: number;
        totalPaid: number;
        totalUnpaid: number;
    };
};

export async function getExpenses(params?: ExpenseListParams): Promise<ExpensesPage> {
    const url = new URL(BASE_URL);
    if (params?.categoryId) url.searchParams.set('categoryId', params.categoryId);
    if (params?.businessId) url.searchParams.set('businessId', params.businessId);
    if (params?.branchId) url.searchParams.set('branchId', params.branchId);
    if (params?.branchIds) params.branchIds.forEach(id => url.searchParams.append('branchIds', id));
    if (params?.from) url.searchParams.set('from', params.from);
    if (params?.to) url.searchParams.set('to', params.to);
    if (typeof params?.isAdExpense === 'boolean') url.searchParams.set('isAdExpense', String(params.isAdExpense));
    if (params?.platform) url.searchParams.set('platform', params.platform);
    if (params?.cursor) url.searchParams.set('cursor', params.cursor);
    if (params?.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
    if (params?.search) url.searchParams.set('search', params.search);
    if (params?.includeTotal) url.searchParams.set('includeTotal', 'true');

    const res = await fetch(url.toString(), { cache: 'no-store' });
    return handleApiResponse<ExpensesPage>(res);
}

export async function createExpense(input: {
    date: string;
    categoryId: string;
    amount: number;
    notes?: string;
    businessId?: string | null;
    branchId?: string | null;
    isAdExpense: boolean;
    platform?: string | null;
    isPaid?: boolean;
    paidFromAccountId?: string | null;
    payableAccountId?: string | null;
    paidAt?: string | null;
    check?: number;
    checkDate?: string | null;
    checkNo?: string;
    approvalStatus?: string;
    submittedById?: string;
    submittedByName?: string;
}): Promise<Expense> {
    const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });

    return handleApiResponse<Expense>(res);
}

export async function updateExpense(id: string, input: Partial<{
    date: string;
    categoryId: string;
    amount: number;
    notes?: string;
    businessId?: string | null;
    branchId?: string | null;
    isAdExpense: boolean;
    platform?: string | null;
    isPaid?: boolean;
    paidFromAccountId?: string | null;
    payableAccountId?: string | null;
    paidAt?: string | null;
    check?: number;
    checkDate?: string | null;
    checkNo?: string;
    approvalStatus?: string;
    rejectionNote?: string;
    approvedById?: string;
    approvedByName?: string;
    rejectedById?: string;
    rejectedByName?: string;
    paidById?: string;
    paidByName?: string;
}>): Promise<Expense> {
    const res = await fetch(`${BASE_URL}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });

    return handleApiResponse<Expense>(res);
}

export async function deleteExpense(id: string): Promise<{ id: string; deleted: boolean }> {
    const res = await fetch(`${BASE_URL}/${id}`, { method: 'DELETE' });
    return handleApiResponse<{ id: string; deleted: boolean }>(res);
}

export async function getExpenseCategories(): Promise<ExpenseCategory[]> {
    const res = await fetch(`${getBaseUrl()}/api/expenses/categories`, { cache: 'no-store' });
    return handleApiResponse<ExpenseCategory[]>(res);
}
