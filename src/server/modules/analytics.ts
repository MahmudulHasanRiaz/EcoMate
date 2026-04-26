import prisma from '@/lib/prisma';
import { OrderStatus } from '@prisma/client';
import { startOfMonth, subMonths, endOfMonth, format } from 'date-fns';
import { getRedisClient } from '@/server/queues/redis';

const ANALYTICS_CACHE_TTL_MS = 120 * 1000; // 2 minutes
const ANALYTICS_CACHE_TTL_SEC = Math.floor(ANALYTICS_CACHE_TTL_MS / 1000);
const analyticsCache = new Map<string, { expires: number; data: AnalyticsData }>();

const buildAnalyticsCacheKey = (businessId?: string, startDate?: Date, endDate?: Date) =>
    `analytics:v1:${businessId || 'all'}:${startDate?.toISOString() || 'none'}:${endDate?.toISOString() || 'none'}`;

export type AnalyticsData = {
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

const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

export async function getRealAnalyticsData(businessId?: string, startDate?: Date, endDate?: Date): Promise<AnalyticsData> {
    const whereOrder: any = {};
    const whereExpense: any = {};
    const whereSnapshot: any = {};
    const whereStaffPayment: any = {};
    const excludedStatusLabels = ['Canceled', 'Incomplete-Cancelled'];
    const excludedStatuses: OrderStatus[] = excludedStatusLabels.map((status) =>
        status === 'Incomplete-Cancelled' ? OrderStatus.Incomplete_Cancelled : (status as OrderStatus)
    );
    const whereGov: any = { status: { notIn: excludedStatuses } };

    if (businessId && businessId !== 'all') {
        whereExpense.businessId = businessId;
        whereSnapshot.businessId = businessId;
        whereStaffPayment.staff = {
            OR: [
                { role: 'Admin' },
                { accessibleBusinesses: { some: { id: businessId } } },
            ],
        };
        whereGov.businessId = businessId;
    }

    if (startDate || endDate) {
        whereExpense.date = {};
        whereSnapshot.Order = { date: {} };
        whereStaffPayment.date = {};
        whereGov.date = {};
        if (startDate) {
            whereExpense.date.gte = startDate;
            whereSnapshot.Order.date.gte = startDate;
            whereStaffPayment.date.gte = startDate;
            whereGov.date.gte = startDate;
        }
        if (endDate) {
            whereExpense.date.lte = endDate;
            whereSnapshot.Order.date.lte = endDate;
            whereStaffPayment.date.lte = endDate;
            whereGov.date.lte = endDate;
        }
    }

    // 1. Summary Queries (snapshot-driven)
    const [snapshotAgg, govAgg, expenseAgg, adExpenseAgg] = await Promise.all([
        prisma.orderFinancialSnapshot.aggregate({
            where: whereSnapshot,
            _sum: {
                revenue: true,
                cogs: true,
                courierExpense: true,
                returnFeeRevenue: true,
            },
        }),
        prisma.order.aggregate({
            where: whereGov,
            _sum: { total: true, discount: true },
        }),
        prisma.expense.aggregate({
            where: whereExpense,
            _sum: { amount: true },
        }),
        prisma.expense.aggregate({
            where: { ...whereExpense, isAdExpense: true },
            _sum: { amount: true },
        }),
    ]);
    // Get staff payments to calculate cleared funds
    // CRITICAL: Only include unlinked staff payments to avoid double-counting with Expense
    const staffPaymentsData = await prisma.staffPayment.findMany({
        where: {
            ...whereStaffPayment,
            Expense: { is: null }, // Exclude linked to avoid double count
        },
        select: { amount: true, check: true, checkStatus: true },
    });

    // Calculate cleared staff payment expenses
    const clearedStaffExpenses = staffPaymentsData.reduce((sum, p) => {
        const amount = Number(p.amount || 0);
        const checkAmount = Math.max(0, Math.min(Number(p.check || 0), amount));
        const cashPortion = Math.max(0, amount - checkAmount);
        const passedCheckPortion = p.checkStatus === 'Passed' ? checkAmount : 0;
        return sum + cashPortion + passedCheckPortion;
    }, 0);

    const totalRevenue = snapshotAgg._sum.revenue || 0;
    const totalCogs = snapshotAgg._sum.cogs || 0;
    const courierExpenseTotal = snapshotAgg._sum.courierExpense || 0;
    const returnFeeRevenueTotal = snapshotAgg._sum.returnFeeRevenue || 0;
    const baseExpenses = expenseAgg._sum.amount || 0;
    const totalExpenses = baseExpenses + clearedStaffExpenses; // Add cleared staff payments
    const adExpenses = adExpenseAgg._sum.amount || 0;
    const gov = govAgg._sum.total || 0;
    const grossBeforeDiscount = gov + (govAgg._sum.discount || 0);

    const grossProfit = totalRevenue - totalCogs;
    const netProfit =
        totalRevenue + returnFeeRevenueTotal - totalCogs - courierExpenseTotal - totalExpenses;

    const summary = {
        gov,
        grossBeforeDiscount,
        totalRevenue,
        cogs: totalCogs,
        grossProfit,
        expenses: totalExpenses,
        adExpenses,
        netProfit,
    };

    // 2. Monthly Breakdown
    const monthlyBreakdown: AnalyticsData['monthlyBreakdown'] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
        const monthStart = startOfMonth(subMonths(now, i));
        const monthEnd = endOfMonth(subMonths(now, i));
        const monthLabel = format(monthStart, 'MMM');

        const [mSnap, mExp] = await Promise.all([
            prisma.orderFinancialSnapshot.aggregate({
                where: {
                    ...whereSnapshot,
                    Order: { date: { gte: monthStart, lte: monthEnd } },
                },
                _sum: {
                    revenue: true,
                    cogs: true,
                    courierExpense: true,
                    returnFeeRevenue: true,
                },
            }),
            prisma.expense.aggregate({
                where: { ...whereExpense, date: { gte: monthStart, lte: monthEnd } },
                _sum: { amount: true },
            }),
        ]);
        // Fetch staff payments for this month with cleared-funds logic
        // CRITICAL: Only unlinked to prevent double-counting
        const mStaffPayments = await prisma.staffPayment.findMany({
            where: {
                ...whereStaffPayment,
                date: { gte: monthStart, lte: monthEnd },
                Expense: { is: null }, // Exclude linked to avoid double count
            },
            select: { amount: true, check: true, checkStatus: true },
        });

        // Calculate cleared staff payment expenses for this month
        const clearedStaffExpensesMonth = mStaffPayments.reduce((sum, p) => {
            const amount = Number(p.amount || 0);
            const checkAmount = Math.max(0, Math.min(Number(p.check || 0), amount));
            const cashPortion = Math.max(0, amount - checkAmount);
            const passedCheckPortion = p.checkStatus === 'Passed' ? checkAmount : 0;
            return sum + cashPortion + passedCheckPortion;
        }, 0);

        const rev = mSnap._sum.revenue || 0;
        const cogs = mSnap._sum.cogs || 0;
        const courierExpense = mSnap._sum.courierExpense || 0;
        const returnFeeRevenue = mSnap._sum.returnFeeRevenue || 0;
        const exp = (mExp._sum.amount || 0) + clearedStaffExpensesMonth; // Add cleared staff payments
        const profit = rev + returnFeeRevenue - cogs - courierExpense - exp;

        monthlyBreakdown.push({
            month: monthLabel,
            revenue: rev,
            cogs,
            expenses: exp,
            profit
        });
    }

    // 3. Expense Breakdown
    const expenseGroups = await prisma.expense.groupBy({
        by: ['categoryId'],
        where: whereExpense,
        _sum: { amount: true }
    });

    const categories = await prisma.expenseCategory.findMany({
        where: { id: { in: expenseGroups.map(g => g.categoryId) } }
    });

    const expenseBreakdown = expenseGroups.map((group, index) => {
        const cat = categories.find(c => c.id === group.categoryId);
        return {
            category: cat?.name || 'Other',
            amount: group._sum.amount || 0,
            fill: CHART_COLORS[index % CHART_COLORS.length]
        };
    });

    return {
        summary,
        monthlyBreakdown,
        expenseBreakdown
    };
}

export async function getAnalyticsDataCached(businessId?: string, startDate?: Date, endDate?: Date) {
    const key = buildAnalyticsCacheKey(businessId, startDate, endDate);
    const now = Date.now();

    const mem = analyticsCache.get(key);
    if (mem && mem.expires > now) return mem.data;

    const redis = getRedisClient();
    if (redis) {
        try {
            const cached = await redis.get(key);
            if (cached) {
                const parsed = JSON.parse(cached) as AnalyticsData;
                analyticsCache.set(key, { expires: now + ANALYTICS_CACHE_TTL_MS, data: parsed });
                return parsed;
            }
        } catch (err) {
            console.warn('[ANALYTICS_CACHE_REDIS_READ_FAIL]', err);
        }
    }

    const data = await getRealAnalyticsData(businessId, startDate, endDate);
    analyticsCache.set(key, { expires: now + ANALYTICS_CACHE_TTL_MS, data });
    if (redis) {
        try {
            await redis.set(key, JSON.stringify(data), 'EX', ANALYTICS_CACHE_TTL_SEC);
        } catch (err) {
            console.warn('[ANALYTICS_CACHE_REDIS_WRITE_FAIL]', err);
        }
    }
    return data;
}
