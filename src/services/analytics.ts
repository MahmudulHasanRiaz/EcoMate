
import { Order, Expense, Product } from '@/types';
import { format } from 'date-fns';

type AnalyticsData = {
    summary: {
        gov: number;
        grossBeforeDiscount: number;
        totalRevenue: number;
        cogs: number;
        grossProfit: number;
        expenses: number;
        adExpenses: number;
        netProfit: number;
    };
    monthlyBreakdown: { month: string; revenue: number; cogs: number; expenses: number; profit: number; }[];
    expenseBreakdown: { category: string; amount: number; fill: string; }[];
};

import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';

export async function getAnalyticsData(
    businessId?: string,
    from?: string,
    to?: string,
    options?: RequestInit
): Promise<AnalyticsData> {
    const url = new URL(`${getBaseUrl()}/api/analytics`);
    if (businessId && businessId !== 'all') url.searchParams.set('businessId', businessId);
    if (from) url.searchParams.set('from', from);
    if (to) url.searchParams.set('to', to);

    const res = await fetch(url.toString(), {
        ...options,
        next: { revalidate: 60, tags: ['analytics'] },
    });

    return handleApiResponse<AnalyticsData>(res);
}
