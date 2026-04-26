import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { ACCOUNT_LABELS, resolveLedgerEntryNumber } from './accounting';
import { getRunningStaffPaid } from './staff';
import { revalidateTags } from '@/server/utils/revalidate';
import { randomBytes } from 'crypto';

export async function listStaffFinesPaginated(params: {
    staffId: string;
    cursor?: string;
    pageSize?: number;
}) {
    const pageSize = Math.min(params.pageSize && params.pageSize > 0 ? params.pageSize : 50, 100);
    const cursor = params.cursor;
    const where = { staffId: params.staffId };

    const rawItems = await prisma.staffFine.findMany({
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

export async function getActiveFineTotalForStaff(
    staffId: string,
    tx?: Prisma.TransactionClient
): Promise<number> {
    const client = tx || prisma;
    const agg = await client.staffFine.aggregate({
        where: { staffId, status: 'Active' },
        _sum: { amount: true },
    });
    return agg._sum.amount || 0;
}

export async function batchGetActiveFineTotals(
    staffIds: string[],
    period?: { from?: string | Date; to?: string | Date },
    tx?: Prisma.TransactionClient
): Promise<Map<string, number>> {
    if (staffIds.length === 0) return new Map();
    const client = tx || prisma;
    const where: any = { staffId: { in: staffIds }, status: 'Active' };

    if (period?.from || period?.to) {
        where.date = {};
        if (period.from) where.date.gte = period.from instanceof Date ? period.from : new Date(period.from);
        if (period.to) where.date.lte = period.to instanceof Date ? period.to : new Date(period.to);
    }

    const aggs = await client.staffFine.groupBy({
        by: ['staffId'],
        where,
        _sum: { amount: true },
    });
    const map = new Map<string, number>();
    aggs.forEach((agg) => {
        map.set(agg.staffId, agg._sum.amount || 0);
    });
    return map;
}

export async function rebuildStaffFineLedger(
    tx: Prisma.TransactionClient,
    fineId: string
) {
    const postingGroup = `staffFine:${fineId}`;

    // 1. Delete existing entries
    await tx.ledgerEntry.deleteMany({
        where: { postingGroup },
    });

    // 2. Fetch Fine
    const fine = await tx.staffFine.findUnique({
        where: { id: fineId },
        include: { staff: true },
    });
    if (!fine || fine.status !== 'Active') return;

    // 3. Resolve Accounts
    // Fine deduction logic: Dr Salaries Payable (Liability decrease), Cr Salary Expense (Expense decrease)
    // Transaction-safe account resolution
    const accounts = await tx.account.findMany({
        where: {
            name: { in: [ACCOUNT_LABELS.salariesPayable, ACCOUNT_LABELS.salary] }
        },
        select: { id: true, name: true }
    });

    const accountMap = new Map(accounts.map(a => [a.name, a.id]));
    const salariesPayableId = accountMap.get(ACCOUNT_LABELS.salariesPayable);
    const salaryExpenseId = accountMap.get(ACCOUNT_LABELS.salary);

    if (!salariesPayableId || !salaryExpenseId) {
        throw new Error('Default accounts for Staff Fine not found (Salaries Payable / Salary Expense).');
    }

    // 4. Create Ledger Entries
    const entryNumber = await resolveLedgerEntryNumber(tx, { postingGroup, date: fine.date });
    const description = `Staff fine: ${fine.staff.name} - ${fine.reason}`;

    await tx.ledgerEntry.createMany({
        data: [
            {
                id: `cm${randomBytes(11).toString('hex')}`,
                date: fine.date,
                entryNumber,
                description,
                sourceTransactionId: fine.id,
                accountId: salariesPayableId,
                debit: fine.amount,
                credit: 0,
                postingGroup,
                createdAt: new Date(),
            },
            {
                id: `cm${randomBytes(11).toString('hex')}`,
                date: fine.date,
                entryNumber,
                description,
                sourceTransactionId: fine.id,
                accountId: salaryExpenseId,
                debit: 0,
                credit: fine.amount,
                postingGroup,
                createdAt: new Date(),
            }
        ]
    });
}

export async function createStaffFineCore(
    payload: {
        staffId: string;
        amount: number;
        date: Date;
        reason: string;
        notes?: string;
        user: string;
    },
    tx?: Prisma.TransactionClient
) {
    // Wrap in transaction if not provided
    const execute = async (client: Prisma.TransactionClient) => {
        const { staffId, amount, date, reason, notes, user } = payload;

        if (amount <= 0) throw new Error('Amount must be positive.');

        // 1. Constraint Check: Cannot fine more than Current Due
        // Current Due = Earned - Paid - ExistingActiveFines

        const incomeAgg = await client.staffIncome.aggregate({
            where: { staffId },
            _sum: { amount: true }
        });
        const totalEarned = incomeAgg._sum.amount || 0;

        // Use helper export from staff module (careful with circular deps, but here we just import function)
        // But getEffectiveStaffPaid might use prisma global if not passed tx.
        // We must pass client tx.
        const totalPaid = await getRunningStaffPaid(staffId, client);

        const existingFines = await getActiveFineTotalForStaff(staffId, client);

        const currentNetDue = Math.max(0, totalEarned - totalPaid - existingFines);

        if (amount > currentNetDue) {
            throw new Error(`Cannot fine ${amount}. Max deduction allowed is ${currentNetDue}.`);
        }

        // 2. Create Fine
        const fine = await client.staffFine.create({
            data: {
                staffId,
                date,
                amount,
                reason,
                notes,
                status: 'Active',
                createdById: null, // Basic implementation
                createdByName: user,
            }
        });

        // 3. Rebuild Ledger
        await rebuildStaffFineLedger(client, fine.id);

        return fine;
    };

    if (tx) {
        return execute(tx);
    } else {
        const result = await prisma.$transaction(execute);
        await revalidateTags(['staff', 'accounting', 'ledger']);
        return result;
    }
}

export async function voidStaffFineCore(
    fineId: string,
    actor: { id?: string; name: string },
    tx?: Prisma.TransactionClient
) {
    const execute = async (client: Prisma.TransactionClient) => {
        const fine = await client.staffFine.findUnique({ where: { id: fineId } });
        if (!fine) throw new Error('Fine not found.');
        if (fine.status === 'Voided') throw new Error('Fine is already voided.');

        await client.staffFine.update({
            where: { id: fineId },
            data: {
                status: 'Voided',
                voidedAt: new Date(),
                voidedByName: actor.name,
                voidedById: actor.id,
            }
        });

        await rebuildStaffFineLedger(client, fineId); // This will remove entries
    };

    if (tx) {
        return execute(tx);
    } else {
        await prisma.$transaction(execute);
        await revalidateTags(['staff', 'accounting', 'ledger']);
    }
}
