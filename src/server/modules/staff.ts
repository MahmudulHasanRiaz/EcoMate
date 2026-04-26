export * from '@/services/staff';
export { getAttendanceSummary } from './attendance';

import prisma from '@/lib/prisma';
import { Prisma, StaffRole } from '@prisma/client';
import { revalidateTags } from '@/server/utils/revalidate';
import { StaffMember } from '@/types';

/**
 * Calculates effective paid amount for a staff member.
 * Only includes cash portion + passed check portion (cleared funds).
 * Pending/Bounced/Cancelled checks are excluded.
 */
export async function getEffectiveStaffPaid(
    staffId: string,
    tx?: Prisma.TransactionClient
): Promise<number> {
    const client = tx || prisma;
    const payments = await client.staffPayment.findMany({
        where: { staffId },
        select: { amount: true, check: true, checkStatus: true },
    });

    return payments.reduce((sum, p) => {
        const amount = Number(p.amount || 0);
        const checkAmount = Math.max(0, Math.min(Number(p.check || 0), amount));
        const cashPortion = Math.max(0, amount - checkAmount);
        const passedCheckPortion = p.checkStatus === 'Passed' ? checkAmount : 0;
        return sum + cashPortion + passedCheckPortion;
    }, 0);
}

/**
 * Batch version: Calculates effective paid amounts for multiple staff members.
 * Returns a Map of staffId -> cleared paid amount.
 */
export async function batchGetEffectiveStaffPaid(
    staffIds: string[],
    period?: { from?: string | Date; to?: string | Date },
    tx?: Prisma.TransactionClient
): Promise<Map<string, number>> {
    if (staffIds.length === 0) return new Map();

    const client = tx || prisma;
    const where: any = { staffId: { in: staffIds } };

    if (period?.from || period?.to) {
        where.date = {};
        if (period.from) where.date.gte = period.from instanceof Date ? period.from : new Date(period.from);
        if (period.to) where.date.lte = period.to instanceof Date ? period.to : new Date(period.to);
    }

    const payments = await client.staffPayment.findMany({
        where,
        select: { staffId: true, amount: true, check: true, checkStatus: true },
    });

    const map = new Map<string, number>();

    payments.forEach((p) => {
        const amount = Number(p.amount || 0);
        const checkAmount = Math.max(0, Math.min(Number(p.check || 0), amount));
        const cashPortion = Math.max(0, amount - checkAmount);
        const passedCheckPortion = p.checkStatus === 'Passed' ? checkAmount : 0;
        const cleared = cashPortion + passedCheckPortion;

        map.set(p.staffId, (map.get(p.staffId) || 0) + cleared);
    });

    return map;
}

/**
 * Calculates running paid amount for a staff member (used for due calculation).
 * Includes cash portion + check portion (if Pending, Passed, or null).
 * Bounced/Cancelled checks are excluded from the running total.
 */
export async function getRunningStaffPaid(
    staffId: string,
    tx?: Prisma.TransactionClient
): Promise<number> {
    const client = tx || prisma;
    const payments = await client.staffPayment.findMany({
        where: { staffId },
        select: { amount: true, check: true, checkStatus: true },
    });

    return payments.reduce((sum, p) => {
        const amount = Number(p.amount || 0);
        const checkAmount = Math.max(0, Math.min(Number(p.check || 0), amount));
        const cashPortion = Math.max(0, amount - checkAmount);
        
        let checkPortion = 0;
        if (checkAmount > 0) {
            if (!p.checkStatus || p.checkStatus === 'Pending' || p.checkStatus === 'Passed') {
                checkPortion = checkAmount;
            }
        }
        
        return sum + cashPortion + checkPortion;
    }, 0);
}

/**
 * Batch version: Calculates running paid amounts for multiple staff members.
 * Returns a Map of staffId -> running paid amount.
 */
export async function batchGetRunningStaffPaid(
    staffIds: string[],
    period?: { from?: string | Date; to?: string | Date },
    tx?: Prisma.TransactionClient
): Promise<Map<string, number>> {
    if (staffIds.length === 0) return new Map();

    const client = tx || prisma;
    const where: any = { staffId: { in: staffIds } };

    if (period?.from || period?.to) {
        where.date = {};
        if (period.from) where.date.gte = period.from instanceof Date ? period.from : new Date(period.from);
        if (period.to) where.date.lte = period.to instanceof Date ? period.to : new Date(period.to);
    }

    const payments = await client.staffPayment.findMany({
        where,
        select: { staffId: true, amount: true, check: true, checkStatus: true },
    });

    const map = new Map<string, number>();

    payments.forEach((p) => {
        const amount = Number(p.amount || 0);
        const checkAmount = Math.max(0, Math.min(Number(p.check || 0), amount));
        const cashPortion = Math.max(0, amount - checkAmount);
        
        let checkPortion = 0;
        if (checkAmount > 0) {
            if (!p.checkStatus || p.checkStatus === 'Pending' || p.checkStatus === 'Passed') {
                checkPortion = checkAmount;
            }
        }
        
        const runningQty = cashPortion + checkPortion;

        map.set(p.staffId, (map.get(p.staffId) || 0) + runningQty);
    });

    return map;
}
export async function getStaffPaymentsPaginated(params: { staffId: string; cursor?: string; pageSize?: number }) {
    const pageSize = Math.min(params.pageSize && params.pageSize > 0 ? params.pageSize : 50, 100);
    const cursor = params.cursor;

    const where = { staffId: params.staffId };

    const rawItems = await prisma.staffPayment.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        cursor: cursor ? { id: cursor } : undefined,
    });

    const hasMore = rawItems.length > pageSize;
    const items = hasMore ? rawItems.slice(0, pageSize) : rawItems;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
}

export async function getStaffIncomePaginated(params: { staffId: string; cursor?: string; pageSize?: number }) {
    const pageSize = Math.min(params.pageSize && params.pageSize > 0 ? params.pageSize : 50, 100);
    const cursor = params.cursor;

    const where = { staffId: params.staffId };

    const rawItems = await prisma.staffIncome.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        cursor: cursor ? { id: cursor } : undefined,
        include: { order: { select: { orderNumber: true } } },
    });

    const hasMore = rawItems.length > pageSize;
    const items = (hasMore ? rawItems.slice(0, pageSize) : rawItems).map(item => ({
        ...item,
        referenceDate: item.referenceDate,
        date: item.referenceDate ? (item.referenceDate instanceof Date ? item.referenceDate.toISOString().slice(0, 10) : item.referenceDate) : (item.createdAt instanceof Date ? item.createdAt.toISOString().slice(0, 10) : item.createdAt),
        notes: item.notes || '',
    }));
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
}


