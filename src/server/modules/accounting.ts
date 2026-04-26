import { AccountType, Prisma, PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { revalidateTags } from '@/server/utils/revalidate';
import { randomBytes } from 'crypto';

type LedgerEntryDTO = {
    id: string;
    date: string;
    entryNumber?: string | null;
    description: string;
    sourceTransactionId: string;
    sourceLabel?: string | null;
    accountId: string;
    debit: number;
    credit: number;
};

const DEFAULT_ACCOUNTS: Array<{ name: string; type: AccountType }> = [
    { name: 'Cash', type: 'Asset' },
    { name: 'Bank', type: 'Asset' },
    { name: 'bKash', type: 'Asset' },
    { name: 'Nagad', type: 'Asset' },
    { name: 'Rocket', type: 'Asset' },
    { name: 'Accounts Receivable', type: 'Asset' },
    { name: 'Inventory', type: 'Asset' },
    { name: 'Work In Progress', type: 'Asset' },
    { name: 'Courier Receivable', type: 'Asset' },
    { name: 'Accounts Payable', type: 'Liability' },
    { name: 'Courier Payable', type: 'Liability' },
    { name: 'Customer Advance / Unearned Revenue', type: 'Liability' },
    { name: 'Salaries Payable', type: 'Liability' },
    { name: "Owner's Equity", type: 'Equity' },
    { name: 'Retained Earnings', type: 'Equity' },
    { name: 'Sales Revenue', type: 'Revenue' },
    { name: 'Sales Return / Allowance', type: 'Revenue' },
    { name: 'Return Fee Revenue', type: 'Revenue' },
    { name: 'Cost of Goods Sold (COGS)', type: 'Expense' },
    { name: 'Courier Expense', type: 'Expense' },
    { name: 'Marketing Expense', type: 'Expense' },
    { name: 'Salary Expense', type: 'Expense' },
    { name: 'Operating Expense', type: 'Expense' },
    { name: 'Inventory Adjustment', type: 'Expense' },
    { name: 'Supplier Advance', type: 'Asset' },
];

export const ACCOUNT_LABELS = {
    cash: 'Cash',
    receivable: 'Accounts Receivable',
    courierReceivable: 'Courier Receivable',
    accountsPayable: 'Accounts Payable',
    courierPayable: 'Courier Payable',
    customerAdvance: 'Customer Advance / Unearned Revenue',
    inventory: 'Inventory',
    wip: 'Work In Progress',
    revenue: 'Sales Revenue',
    salesReturn: 'Sales Return / Allowance',
    returnFee: 'Return Fee Revenue',
    marketing: 'Marketing Expense',
    courierExpense: 'Courier Expense',
    salary: 'Salary Expense',
    salariesPayable: 'Salaries Payable',
    operating: 'Operating Expense',
    inventoryAdjustment: 'Inventory Adjustment',
    supplierAdvance: 'Supplier Advance',
};

export async function ensureDefaultAccounts() {
    const existing = await prisma.account.findMany({ select: { id: true, name: true, type: true } });
    const byName = new Map(existing.map((acc) => [acc.name.toLowerCase(), acc]));
    const missing = DEFAULT_ACCOUNTS.filter((acc) => !byName.has(acc.name.toLowerCase()));
    const mismatched = DEFAULT_ACCOUNTS
        .map((acc) => {
            const current = byName.get(acc.name.toLowerCase());
            if (!current || current.type === acc.type) return null;
            return { id: current.id, type: acc.type };
        })
        .filter(Boolean) as Array<{ id: string; type: AccountType }>;

    if (missing.length === 0 && mismatched.length === 0) return;

    const operations: Prisma.PrismaPromise<unknown>[] = [];
    if (missing.length > 0) {
        operations.push(
            prisma.account.createMany({
                data: missing.map((acc) => ({
                    id: `cm${randomBytes(11).toString('hex')}`,
                    name: acc.name,
                    type: acc.type,
                    updatedAt: new Date()
                })),
                skipDuplicates: true,
            })
        );
    }
    mismatched.forEach((update) => {
        operations.push(
            prisma.account.update({
                where: { id: update.id },
                data: { type: update.type },
            })
        );
    });

    await prisma.$transaction(operations);

    // Ensure LIQUID group is tagged on default liquid accounts
    const liquidNames = ['cash', 'bank', 'bkash', 'nagad', 'rocket'];
    await prisma.account.updateMany({
        where: {
            group: null,
            name: { in: liquidNames, mode: 'insensitive' },
        },
        data: { group: 'LIQUID' },
    });
}

function toIso(value: Date) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function buildAccountIndex(accounts: { id: string; name: string }[]) {
    const index = new Map<string, string>();
    accounts.forEach((acc) => {
        index.set(acc.name.toLowerCase(), acc.id);
    });
    return index;
}

function resolveAccountId(index: Map<string, string>, label: string) {
    return index.get(label.toLowerCase());
}

function normalizeEntryDate(value?: Date | null) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    return new Date();
}

function formatEntryNumber(date: Date, sequence: number) {
    const dateKey = date.toISOString().slice(2, 10).replace(/-/g, '');
    const suffix = String(sequence).padStart(4, '0');
    return `LE-${dateKey}-${suffix}`;
}

type LedgerTx = Prisma.TransactionClient | PrismaClient;

async function getNextLedgerEntryNumber(tx: LedgerTx, date: Date) {
    const dateKey = date.toISOString().slice(2, 10).replace(/-/g, '');
    const sequence = await tx.ledgerEntrySequence.upsert({
        where: { dateKey },
        update: { lastNumber: { increment: 1 } },
        create: {
            id: `cm${randomBytes(11).toString('hex')}`,
            dateKey,
            lastNumber: 1,
            updatedAt: new Date()
        },
        select: { lastNumber: true },
    });
    return formatEntryNumber(date, sequence.lastNumber);
}

export async function resolveLedgerEntryNumber(
    tx: LedgerTx,
    params: { postingGroup?: string | null; date?: Date | null }
) {
    const date = normalizeEntryDate(params.date);
    const postingGroup = params.postingGroup || null;
    if (postingGroup) {
        const existing = await tx.ledgerEntry.findFirst({
            where: { postingGroup, entryNumber: { not: null } },
            select: { entryNumber: true },
        });
        if (existing?.entryNumber) return existing.entryNumber;
    }
    return getNextLedgerEntryNumber(tx, date);
}

export async function getAccountIndex() {
    await ensureDefaultAccounts();
    const accounts = await prisma.account.findMany({ select: { id: true, name: true } });
    return buildAccountIndex(accounts);
}

export async function getAccountIdByName(name: string) {
    if (!name) return undefined;
    const index = await getAccountIndex();
    return resolveAccountId(index, name);
}

function isDateInRange(date: Date, from?: Date, to?: Date) {
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
}

export async function getAccounts() {
    await ensureDefaultAccounts();
    return prisma.account.findMany({
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
}

/** Returns accounts filtered by group (e.g., 'LIQUID' for payment selectors). */
export async function getAccountsByGroup(group: string) {
    await ensureDefaultAccounts();
    return prisma.account.findMany({
        where: { group },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
}

export async function createAccount(payload: { name: string; type: AccountType; group?: string }) {
    const name = payload.name?.trim();
    if (!name) throw new Error('Account name is required');
    if (!payload.type) throw new Error('Account type is required');

    const account = await prisma.account.create({
        data: {
            id: `cm${randomBytes(11).toString('hex')}`,
            name,
            type: payload.type,
            group: payload.group || null,
            updatedAt: new Date()
        },
    });
    await revalidateTags(['accounting', 'accounts']);
    return account;
}

export async function updateAccount(id: string, payload: Partial<{ name: string; type: AccountType; group: string | null }>) {
    if (!id) throw new Error('Account id is required');
    const data: Prisma.AccountUpdateInput = {};
    if (payload.name !== undefined) {
        const name = payload.name.trim();
        if (!name) throw new Error('Account name is required');
        data.name = name;
    }
    if (payload.type !== undefined) {
        data.type = payload.type;
    }
    if (payload.group !== undefined) {
        data.group = payload.group;
    }
    const account = await prisma.account.update({ where: { id }, data });
    await revalidateTags(['accounting', 'accounts']);
    return account;
}

export async function deleteAccount(id: string) {
    if (!id) throw new Error('Account id is required');
    await prisma.account.delete({ where: { id } });
    await revalidateTags(['accounting', 'accounts']);
    return { id, deleted: true };
}

type LedgerQueryParams = {
    accountId?: string;
    from?: Date;
    to?: Date;
    businessId?: string;
    accessibleBusinessIds?: string[];
};

function buildLedgerWhere(params: LedgerQueryParams): Prisma.LedgerEntryWhereInput {
    const where: Prisma.LedgerEntryWhereInput = {};
    if (params.accountId) where.accountId = params.accountId;
    if (params.from || params.to) {
        where.date = {
            gte: params.from,
            lte: params.to,
        };
    }
    if (params.businessId) {
        where.businessId = params.businessId;
    } else if (params.accessibleBusinessIds && params.accessibleBusinessIds.length) {
        where.OR = [
            { businessId: null },
            { businessId: { in: params.accessibleBusinessIds } },
        ];
    }
    return where;
}

async function mapLedgerEntries(ledgerEntries: { id: string; date: Date; entryNumber: string | null; description: string; sourceTransactionId: string | null; accountId: string; debit: any; credit: any; }[]): Promise<LedgerEntryDTO[]> {
    const sourceIds = Array.from(
        new Set(ledgerEntries.map((entry) => entry.sourceTransactionId).filter((id): id is string => !!id))
    );
    const orderNumberMap = new Map<string, string>();
    const courierPaymentMap = new Map<string, string>();

    if (sourceIds.length > 0) {
        try {
            // Resolve orders
            const orders = await prisma.order.findMany({
                where: { id: { in: sourceIds } },
                select: { id: true, orderNumber: true },
            });
            orders.forEach((order) => {
                if (order.orderNumber) {
                    orderNumberMap.set(order.id, order.orderNumber);
                }
            });

            // Resolve courier payments
            const courierPayments = await prisma.courierPayment.findMany({
                where: { id: { in: sourceIds } },
                select: { id: true, referenceNo: true },
            });
            courierPayments.forEach((cp) => {
                if (cp.referenceNo) {
                    courierPaymentMap.set(cp.id, `Invoice ${cp.referenceNo}`);
                }
            });
        } catch (error) {
            console.warn('[WARN:mapLedgerEntries] Failed to resolve source labels', error);
        }
    }

    return ledgerEntries.map((entry) => ({
        id: entry.id,
        date: entry.date.toISOString(),
        entryNumber: entry.entryNumber ?? null,
        description: entry.description,
        sourceTransactionId: entry.sourceTransactionId ?? '',
        sourceLabel: (entry.sourceTransactionId && (orderNumberMap.get(entry.sourceTransactionId) ?? courierPaymentMap.get(entry.sourceTransactionId))) ?? null,
        accountId: entry.accountId,
        debit: Number(entry.debit || 0),
        credit: Number(entry.credit || 0),
    }));
}

export async function getLedgerEntries(params: LedgerQueryParams): Promise<LedgerEntryDTO[]> {
    await ensureDefaultAccounts();
    const where = buildLedgerWhere(params);

    const ledgerEntries = await prisma.ledgerEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });

    return mapLedgerEntries(ledgerEntries);
}

export async function getLedgerEntriesPage(params: LedgerQueryParams & {
    cursor?: string;
    limit?: number;
}): Promise<{ entries: LedgerEntryDTO[]; nextCursor: string | null }> {
    await ensureDefaultAccounts();
    const where = buildLedgerWhere(params);
    const take = Math.min(Math.max(params.limit ?? 50, 1), 200);

    const ledgerEntries = await prisma.ledgerEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take,
        cursor: params.cursor ? { id: params.cursor } : undefined,
        skip: params.cursor ? 1 : 0,
    });

    const entries = await mapLedgerEntries(ledgerEntries);
    const nextCursor = ledgerEntries.length === take ? ledgerEntries[ledgerEntries.length - 1].id : null;
    return { entries, nextCursor };
}

export async function createJournalEntry(payload: {
    date: Date;
    description: string;
    entries: Array<{ accountId: string; debit: number; credit: number }>;
    businessId?: string;
    postingGroup?: string;
}) {
    const date = payload.date;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Invalid date');

    // Pre-cutoff guard: block journal entries for dates before the cutoff boundary
    const { assertNotPreCutoff } = await import('@/server/modules/cutoff');
    await assertNotPreCutoff(date);

    const description = payload.description.trim();
    if (!description) throw new Error('Description is required');
    if (!Array.isArray(payload.entries) || payload.entries.length < 2) {
        throw new Error('At least two ledger rows are required');
    }

    const normalized = payload.entries.map((entry) => ({
        accountId: entry.accountId,
        debit: Number(entry.debit || 0),
        credit: Number(entry.credit || 0),
    }));

    let totalDebit = 0;
    let totalCredit = 0;
    normalized.forEach((entry) => {
        if (!entry.accountId) throw new Error('Account is required');
        totalDebit += entry.debit;
        totalCredit += entry.credit;
        const hasDebit = entry.debit > 0;
        const hasCredit = entry.credit > 0;
        if (hasDebit && hasCredit) throw new Error('Each row must have either a debit or a credit');
        if (!hasDebit && !hasCredit) throw new Error('Each row must have a debit or a credit');
    });

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error('Total debits must equal total credits');
    }

    const sourceTransactionId = `JE-${date.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const postingGroup = payload.postingGroup ?? null;

    const entries = await prisma.$transaction(async (tx) => {
        const entryNumber = await resolveLedgerEntryNumber(tx, { postingGroup, date });
        const created = await Promise.all(
            normalized.map((entry) =>
                tx.ledgerEntry.create({
                    data: {
                        id: `cm${randomBytes(11).toString('hex')}`,
                        date,
                        entryNumber,
                        description,
                        sourceTransactionId,
                        accountId: entry.accountId,
                        debit: entry.debit,
                        credit: entry.credit,
                        businessId: payload.businessId ?? null,
                        postingGroup,
                    },
                })
            )
        );
        return created;
    });

    await revalidateTags(['accounting', 'ledger', 'balance-sheet']);
    return entries;
}

export async function getBalanceSheet(params: { asOf: Date; businessId?: string; accessibleBusinessIds?: string[] }) {
    const { getActiveCutoff, getOpeningBalanceForEntity } = await import('@/server/modules/cutoff');
    const cutoff = await getActiveCutoff();
    
    let effectiveFrom = undefined;
    if (cutoff && params.asOf >= cutoff.cutoffDate) {
        const nextDay = new Date(cutoff.cutoffDate);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(0, 0, 0, 0);
        effectiveFrom = nextDay;
    }

    // Optimized: Use database aggregation instead of fetching all rows
    const where = buildLedgerWhere({
        from: effectiveFrom,
        to: params.asOf,
        businessId: params.businessId,
        accessibleBusinessIds: params.accessibleBusinessIds,
    });

    const aggregates = await prisma.ledgerEntry.groupBy({
        by: ['accountId'],
        where,
        _sum: {
            debit: true,
            credit: true,
        },
    });

    const accounts = await getAccounts();
    const balances: Record<string, number> = {};
    const accountMap = new Map<string, { id: string; name: string; type: AccountType }>();

    accounts.forEach((acc) => {
        balances[acc.id] = 0;
        accountMap.set(acc.id, acc);
    });

    if (cutoff && params.asOf >= cutoff.cutoffDate) {
        for (const acc of accounts) {
            const ob = await getOpeningBalanceForEntity('account', acc.id);
            if (ob) balances[acc.id] = ob;
        }
    }

    const isDebitNormal = (type: AccountType) => type === 'Asset' || type === 'Expense';
    const isNonZero = (value: number) => Math.abs(value) > 0.005;

    aggregates.forEach((agg) => {
        const account = accountMap.get(agg.accountId);
        if (!account) return;
        const debit = Number(agg._sum.debit || 0);
        const credit = Number(agg._sum.credit || 0);
        const delta = isDebitNormal(account.type) ? (debit - credit) : (credit - debit);
        balances[agg.accountId] = (balances[agg.accountId] || 0) + delta;
    });

    const buildItems = (type: AccountType) => accounts
        .filter((acc) => acc.type === type)
        .map((acc) => ({ id: acc.id, name: acc.name, balance: balances[acc.id] || 0 }))
        .filter((acc) => isNonZero(acc.balance));

    const sumByType = (type: AccountType) => accounts
        .filter((acc) => acc.type === type)
        .reduce((sum, acc) => sum + (balances[acc.id] || 0), 0);

    const sumItems = (items: Array<{ balance: number }>) =>
        items.reduce((sum, acc) => sum + acc.balance, 0);

    const assetsItems = buildItems('Asset');
    const liabilitiesItems = buildItems('Liability');
    const equityItems = buildItems('Equity');

    const netIncome = sumByType('Revenue') - sumByType('Expense');
    if (isNonZero(netIncome)) {
        equityItems.push({ id: 'net-income', name: 'Current Period Earnings', balance: netIncome });
    }

    return {
        asOf: params.asOf.toISOString(),
        assets: {
            accounts: assetsItems,
            total: sumItems(assetsItems),
        },
        liabilities: {
            accounts: liabilitiesItems,
            total: sumItems(liabilitiesItems),
        },
        equity: {
            accounts: equityItems,
            total: sumItems(equityItems),
        },
    };
}

export async function getAccountSummary(params: { from?: Date; to?: Date; businessId?: string; accessibleBusinessIds?: string[] }) {
    await ensureDefaultAccounts();
    const accounts = await getAccounts();
    const { getActiveCutoff, getOpeningBalanceForEntity } = await import('@/server/modules/cutoff');
    const cutoff = await getActiveCutoff();
    
    let effectiveFrom = params.from;
    let balanceEffectiveFrom = undefined;
    const isAfterCutoff = cutoff && (!params.to || params.to >= cutoff.cutoffDate);

    if (cutoff) {
        const nextDay = new Date(cutoff.cutoffDate);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(0, 0, 0, 0);

        if (!params.from || params.from < cutoff.cutoffDate) {
            effectiveFrom = nextDay;
        }
        if (isAfterCutoff) {
            balanceEffectiveFrom = nextDay;
        }
    }
    
    // Period Totals
    const periodWhere = buildLedgerWhere({
        from: effectiveFrom,
        to: params.to,
        businessId: params.businessId,
        accessibleBusinessIds: params.accessibleBusinessIds,
    });
    const periodAgg = await prisma.ledgerEntry.groupBy({
        by: ['accountId'],
        where: periodWhere,
        _sum: { debit: true, credit: true },
    });

    // Total Balance (up to 'to' date, or all time if 'to' is undefined)
    const balanceWhere = buildLedgerWhere({
        from: balanceEffectiveFrom,
        to: params.to,
        businessId: params.businessId,
        accessibleBusinessIds: params.accessibleBusinessIds,
    });
    const balanceAgg = await prisma.ledgerEntry.groupBy({
        by: ['accountId'],
        where: balanceWhere,
        _sum: { debit: true, credit: true },
    });

    const periodMap = new Map(periodAgg.map(a => [a.accountId, a._sum]));
    const balanceMap = new Map(balanceAgg.map(a => [a.accountId, a._sum]));

    const openingBalances = new Map<string, number>();
    if (isAfterCutoff) {
        for (const acc of accounts) {
            const ob = await getOpeningBalanceForEntity('account', acc.id);
            if (ob) openingBalances.set(acc.id, ob);
        }
    }

    const isDebitNormal = (type: AccountType) => type === 'Asset' || type === 'Expense';

    return accounts.map(acc => {
        const pSum = periodMap.get(acc.id) || { debit: 0, credit: 0 };
        const bSum = balanceMap.get(acc.id) || { debit: 0, credit: 0 };
        
        const bDebit = Number(bSum.debit || 0);
        const bCredit = Number(bSum.credit || 0);
        let balance = isDebitNormal(acc.type) ? (bDebit - bCredit) : (bCredit - bDebit);

        if (isAfterCutoff) {
            const ob = openingBalances.get(acc.id) || 0;
            balance += ob;
        }

        return {
            accountId: acc.id,
            name: acc.name,
            type: acc.type,
            periodDebit: Number(pSum.debit || 0),
            periodCredit: Number(pSum.credit || 0),
            balance,
        };
    });
}
