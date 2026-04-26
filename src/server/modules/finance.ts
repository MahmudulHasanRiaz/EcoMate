import prisma from '@/lib/prisma';
import type { Prisma, OrderStatus } from '@prisma/client';
import { computeCourierCharges } from './courier/charges';
import { ACCOUNT_LABELS, ensureDefaultAccounts, resolveLedgerEntryNumber } from './accounting';
import { dbMath } from '../utils/db-math';

type SnapshotComputation = {
    status: OrderStatus | null;
    revenue: number;
    cogs: number;
    cogsDeductTotal: number;
    courierExpense: number;
    courierReceivable: number;
    courierPayable: number;
    cashReceived: number;
    returnFeeRevenue: number;
    netProfit: number;
    cogsEstimated: boolean;
};

type AccountIndex = Map<string, string>;

function computeCashReceived(order: any) {
    const paidAmount = dbMath.norm(order?.paidAmount);
    const shippingPaidAmount = order?.shippingPaid ? dbMath.norm(order?.shippingPaidAmount) : 0;
    return dbMath.add(paidAmount, shippingPaidAmount);
}

function computeDueAmount(order: any) {
    const total = dbMath.norm(order?.total);
    const cashReceived = computeCashReceived(order);
    const due = dbMath.sub(total, cashReceived);
    return due > 0 ? due : 0;
}

async function buildAccountIndex(tx: Prisma.TransactionClient): Promise<AccountIndex> {
    await ensureDefaultAccounts();
    const accounts = await tx.account.findMany({ select: { id: true, name: true } });
    const index = new Map<string, string>();
    accounts.forEach((acc) => {
        index.set(acc.name.toLowerCase(), acc.id);
    });
    return index;
}

function resolveAccount(index: AccountIndex, label: string) {
    const id = index.get(label.toLowerCase());
    if (!id) throw new Error(`Missing account: ${label}`);
    return id;
}

async function getCourierRateConfig(tx: Prisma.TransactionClient, order: any) {
    const courierService = order?.courierService;
    if (!courierService) return null;

    const integration = await tx.courierIntegration.findFirst({
        where: { businessId: order?.businessId ?? undefined, courierName: courierService, status: 'Active' },
        select: { credentials: true },
    });
    return (integration?.credentials as any)?.rateConfig ?? null;
}

async function computeCogsFromAllocations(
    tx: Prisma.TransactionClient,
    order: any,
): Promise<{ cogs: number; deductTotal: number; restoreTotal: number; estimated: boolean }> {
    const allocations = await tx.orderStockAllocation.findMany({
        where: { orderId: order.id },
    });

    const unitCostCache = new Map<string, number>();
    const resolveUnitCost = async (productId: string, variantId?: string | null) => {
        const key = `${productId}:${variantId ?? 'none'}`;
        if (unitCostCache.has(key)) return unitCostCache.get(key) || 0;
        const inventoryItems = await tx.inventoryItem.findMany({
            where: { productId, variantId: variantId ?? null },
            select: { quantity: true, unitCost: true },
        });
        const totalQty = inventoryItems.reduce((sum, inv) => dbMath.add(sum, dbMath.norm(inv.quantity)), 0);
        const totalCost = inventoryItems.reduce((sum, inv) =>
            dbMath.add(sum, dbMath.mult(dbMath.norm(inv.unitCost), dbMath.norm(inv.quantity))), 0);
        const unitCost = dbMath.div(totalCost, totalQty);
        unitCostCache.set(key, unitCost);
        return unitCost;
    };

    const allocationByItem = new Map<string, { deductQty: number; deductCost: number; restoreQty: number; restoreCost: number }>();

    let deductTotal = 0;
    let restoreTotal = 0;
    allocations.forEach((alloc) => {
        const cost = dbMath.norm(alloc.totalCost);
        const qty = dbMath.norm(alloc.quantity);
        const key = `${alloc.productId}:${alloc.variantId ?? ''}`;
        const entry = allocationByItem.get(key) || { deductQty: 0, deductCost: 0, restoreQty: 0, restoreCost: 0 };
        if (alloc.action === 'restore') {
            restoreTotal = dbMath.add(restoreTotal, cost);
            entry.restoreQty = dbMath.add(entry.restoreQty, qty);
            entry.restoreCost = dbMath.add(entry.restoreCost, cost);
        } else {
            deductTotal = dbMath.add(deductTotal, cost);
            entry.deductQty = dbMath.add(entry.deductQty, qty);
            entry.deductCost = dbMath.add(entry.deductCost, cost);
        }
        allocationByItem.set(key, entry);
    });

    if (deductTotal > 0) {
        const items = Array.isArray(order.products) ? order.products : [];
        let missingCost = 0;
        let estimated = false;
        const allowZeroCostFallback = order?.status === 'Delivered' || order?.status === 'Damaged';
        if (items.length) {
            for (const item of items) {
                const productId = item.productId;
                const variantId = item.variantId ?? null;
                const qty = dbMath.norm(item.quantity);
                if (!productId || qty <= 0) continue;
                const key = `${productId}:${variantId ?? ''}`;
                const alloc = allocationByItem.get(key);
                const allocatedQty = alloc ? dbMath.sub(alloc.deductQty, alloc.restoreQty) : 0;
                const allocatedCost = alloc ? dbMath.sub(alloc.deductCost, alloc.restoreCost) : 0;
                let qtyToEstimate = Math.max(dbMath.sub(qty, allocatedQty), 0);
                if (allowZeroCostFallback && allocatedQty > 0 && allocatedCost <= 0) {
                    qtyToEstimate = dbMath.add(qtyToEstimate, allocatedQty);
                }
                if (qtyToEstimate <= 0) continue;
                const unitCost = await resolveUnitCost(productId, variantId);
                const estimatedCost = dbMath.mult(unitCost, qtyToEstimate);
                if (estimatedCost > 0) {
                    estimated = true;
                    missingCost = dbMath.add(missingCost, estimatedCost);
                }
            }
        }
        const net = Math.max(dbMath.sub(deductTotal, restoreTotal), 0);
        const cogs = dbMath.add(net, missingCost);
        return {
            cogs,
            deductTotal: dbMath.add(deductTotal, missingCost),
            restoreTotal,
            estimated,
        };
    }

    if (order.type === 'PARTIAL_RETURN' && order.parentOrderId) {
        const parentAllocations = await tx.orderStockAllocation.findMany({
            where: { orderId: order.parentOrderId, action: 'deduct' },
        });
        if (parentAllocations.length > 0) {
            const costMap = new Map<string, { qty: number; total: number }>();
            parentAllocations.forEach((alloc) => {
                const key = `${alloc.productId}:${alloc.variantId ?? ''}`;
                const entry = costMap.get(key) || { qty: 0, total: 0 };
                entry.qty = dbMath.add(entry.qty, dbMath.norm(alloc.quantity));
                entry.total = dbMath.add(entry.total, dbMath.norm(alloc.totalCost));
                costMap.set(key, entry);
            });
            let estimatedCogs = 0;
            const items = Array.isArray(order.products) ? order.products : [];
            items.forEach((item: any) => {
                const key = `${item.productId}:${item.variantId ?? ''}`;
                const entry = costMap.get(key);
                if (!entry || entry.qty <= 0) return;
                const unitCost = dbMath.div(entry.total, entry.qty);
                const itemCost = dbMath.mult(unitCost, dbMath.norm(item.quantity));
                estimatedCogs = dbMath.add(estimatedCogs, itemCost);
            });
            return { cogs: estimatedCogs, deductTotal: 0, restoreTotal: 0, estimated: true };
        }
    }

    const items = Array.isArray(order.products) ? order.products : [];
    let estimated = 0;
    for (const item of items) {
        const productId = item.productId;
        const variantId = item.variantId ?? null;
        const qty = dbMath.norm(item.quantity);
        if (!productId || qty <= 0) continue;
        const inventoryItems = await tx.inventoryItem.findMany({
            where: { productId, variantId },
            select: { quantity: true, unitCost: true },
        });
        const totalQty = inventoryItems.reduce((sum, inv) => dbMath.add(sum, dbMath.norm(inv.quantity)), 0);
        const totalCost = inventoryItems.reduce((sum, inv) => dbMath.add(sum, dbMath.mult(dbMath.norm(inv.unitCost), dbMath.norm(inv.quantity))), 0);
        const unitCost = dbMath.div(totalCost, totalQty);
        estimated = dbMath.add(estimated, dbMath.mult(unitCost, qty));
    }
    return { cogs: estimated, deductTotal: 0, restoreTotal: 0, estimated: true };
}

async function computeSnapshot(tx: Prisma.TransactionClient, order: any): Promise<SnapshotComputation> {
    const status = order?.status ?? null;
    const total = dbMath.norm(order?.total);
    const isDelivered = status === 'Delivered';
    const isReturned = status === 'Returned' || status === 'Paid_Return';
    const isDamaged = status === 'Damaged';
    const isSplitReturn = order?.type === 'PARTIAL_RETURN';

    const cashReceived = computeCashReceived(order);
    const due = isReturned || isDamaged ? 0 : computeDueAmount(order);
    const courierService = order?.courierService;

    let courierDeliveryCharge = 0;
    let courierCodCharge = 0;
    if (courierService && !isSplitReturn) {
        if (order?.courierChargesSource === 'Invoice') {
            // Ignore config rates entirely; use what's stored from the invoice
            courierDeliveryCharge = dbMath.norm(order?.courierDeliveryCharge);
            courierCodCharge = dbMath.norm(order?.courierCodCharge);
        } else {
            const rateConfig = await getCourierRateConfig(tx, order);
            const computed = computeCourierCharges(
                { ...order, actualCodAmount: due },
                courierService,
                rateConfig,
                { isReturn: isReturned || isDamaged }
            );
            courierDeliveryCharge = dbMath.norm(computed.courierDeliveryCharge);
            courierCodCharge = dbMath.norm(computed.courierCodCharge);

            const storedDeliveryCharge = dbMath.norm(order?.courierDeliveryCharge);
            const storedCodCharge = dbMath.norm(order?.courierCodCharge);
            if (courierDeliveryCharge <= 0 && storedDeliveryCharge > 0) {
                courierDeliveryCharge = storedDeliveryCharge;
            }
            if (!isReturned && !isDamaged && due > 0 && courierCodCharge <= 0 && storedCodCharge > 0) {
                courierCodCharge = storedCodCharge;
            }
        }
    }

    const courierExpense = isSplitReturn ? 0 : dbMath.add(courierDeliveryCharge, courierCodCharge);
    const courierReceivable = isSplitReturn ? 0 : Math.max(dbMath.sub(due, courierExpense), 0);
    const courierPayable = isSplitReturn ? 0 : Math.max(dbMath.sub(courierExpense, due), 0);

    const cogsInfo = await computeCogsFromAllocations(tx, order);
    const cogs = (isDelivered || isDamaged) ? cogsInfo.cogs : 0;
    const revenue = isDelivered ? total : 0;
    const returnFeeRevenue = (isReturned || isDamaged) ? cashReceived : 0;
    // Net Profit = Revenue + ReturnFee - COGS - CourierExpense
    const netProfit = dbMath.sub(dbMath.add(revenue, returnFeeRevenue), dbMath.add(cogs, courierExpense));

    return {
        status,
        revenue,
        cogs,
        cogsDeductTotal: cogsInfo.deductTotal > 0 ? cogsInfo.deductTotal : cogsInfo.cogs,
        courierExpense,
        courierReceivable,
        courierPayable,
        cashReceived,
        returnFeeRevenue,
        netProfit,
        cogsEstimated: cogsInfo.estimated,
    };
}

async function postLedgerEntries(
    tx: Prisma.TransactionClient,
    params: {
        order: any;
        snapshotId: string;
        postingGroup: string;
        data: SnapshotComputation;
    }
) {
    const { order, snapshotId, postingGroup, data } = params;
    const index = await buildAccountIndex(tx);
    const desiredEntries: Array<{ accountId: string; debit: number; credit: number; label: string }> = [];

    const addEntry = (accountId: string, debit: number, credit: number, label: string) => {
        const d = dbMath.norm(debit);
        const c = dbMath.norm(credit);
        if (d <= 0 && c <= 0) return;
        desiredEntries.push({ accountId, debit: d, credit: c, label });
    };

    const revenueAccount = resolveAccount(index, ACCOUNT_LABELS.revenue);
    const salesReturnAccount = resolveAccount(index, ACCOUNT_LABELS.salesReturn);
    const returnFeeAccount = resolveAccount(index, ACCOUNT_LABELS.returnFee);
    const customerAdvanceAccount = resolveAccount(index, ACCOUNT_LABELS.customerAdvance);
    const courierExpenseAccount = resolveAccount(index, ACCOUNT_LABELS.courierExpense);
    const courierReceivableAccount = resolveAccount(index, ACCOUNT_LABELS.courierReceivable);
    const courierPayableAccount = resolveAccount(index, ACCOUNT_LABELS.courierPayable);
    const inventoryAccount = resolveAccount(index, ACCOUNT_LABELS.inventory);
    const cogsAccount = resolveAccount(index, 'Cost of Goods Sold (COGS)');

    const status = order?.status;
    const isDelivered = status === 'Delivered';
    const isReturned = status === 'Returned' || status === 'Paid_Return';
    const isDamaged = status === 'Damaged';
    const isSplitReturn = order?.type === 'PARTIAL_RETURN';

    const total = dbMath.norm(order?.total);
    const cashReceived = data.cashReceived;
    const courierExpense = data.courierExpense;
    const courierReceivable = data.courierReceivable;
    const courierPayable = data.courierPayable;
    const cogsTotal = isReturned ? data.cogsDeductTotal : data.cogs;

    if (isDelivered) {
        addEntry(customerAdvanceAccount, cashReceived, 0, ACCOUNT_LABELS.customerAdvance);
        addEntry(courierExpenseAccount, courierExpense, 0, ACCOUNT_LABELS.courierExpense);
        addEntry(courierReceivableAccount, courierReceivable, 0, ACCOUNT_LABELS.courierReceivable);
        addEntry(courierPayableAccount, 0, courierPayable, ACCOUNT_LABELS.courierPayable);
        addEntry(revenueAccount, 0, total, ACCOUNT_LABELS.revenue);

        addEntry(cogsAccount, cogsTotal, 0, 'Cost of Goods Sold (COGS)');
        addEntry(inventoryAccount, 0, cogsTotal, ACCOUNT_LABELS.inventory);
    } else if (isReturned || isDamaged) {
        addEntry(salesReturnAccount, total, 0, ACCOUNT_LABELS.salesReturn);
        addEntry(revenueAccount, 0, total, ACCOUNT_LABELS.revenue);

        if (!isDamaged) {
            addEntry(inventoryAccount, cogsTotal, 0, ACCOUNT_LABELS.inventory);
            addEntry(cogsAccount, 0, cogsTotal, 'Cost of Goods Sold (COGS)');
        } else {
            addEntry(cogsAccount, cogsTotal, 0, 'Cost of Goods Sold (COGS)');
            addEntry(inventoryAccount, 0, cogsTotal, ACCOUNT_LABELS.inventory);
        }

        if (!isSplitReturn) {
            addEntry(courierExpenseAccount, courierExpense, 0, ACCOUNT_LABELS.courierExpense);
            addEntry(courierPayableAccount, 0, courierExpense, ACCOUNT_LABELS.courierPayable);
        }

        if (cashReceived > 0) {
            addEntry(customerAdvanceAccount, cashReceived, 0, ACCOUNT_LABELS.customerAdvance);
            addEntry(returnFeeAccount, 0, cashReceived, ACCOUNT_LABELS.returnFee);
        }
    }

    const entryNumber = await resolveLedgerEntryNumber(tx, {
        postingGroup,
        date: order?.date ?? new Date(),
    });

    const sourceTransactionId = order.id;

    // Optimization: Diffing strategy instead of delete-all
    const existingEntries = await tx.ledgerEntry.findMany({ where: { postingGroup } });

    // Track which existing entries have been matched
    const matchedExistingIds = new Set<string>();

    for (const desired of desiredEntries) {
        // Find a matching existing entry (same account, roughly same role)
        // Ideally we match by accountId. If there are multiple entries for same account, we need careful handling.
        // For simplicity in this snapshot logic, usually one account appears once per role (Debit OR Credit).
        // But in some complex cases (e.g. self-transfer), account might appear twice.
        // We will greedily match the first available existing entry with same accountId that hasn't been used.
        const match = existingEntries.find(e =>
            e.accountId === desired.accountId &&
            !matchedExistingIds.has(e.id) &&
            // Optional: try to match direction (debit vs credit) to reduce update noise
            ((desired.debit > 0 && e.debit > 0) || (desired.credit > 0 && e.credit > 0))
        );

        if (match) {
            matchedExistingIds.add(match.id);
            // Updating existing entry if values differ
            const needsUpdate =
                dbMath.norm(match.debit) !== desired.debit ||
                dbMath.norm(match.credit) !== desired.credit ||
                match.description !== `Order snapshot — ${desired.label}`; // Description update if label changed

            if (needsUpdate) {
                await tx.ledgerEntry.update({
                    where: { id: match.id },
                    data: {
                        debit: desired.debit,
                        credit: desired.credit,
                        description: `Order snapshot — ${desired.label}`,
                        date: order?.date ?? new Date(), // sync date if changed
                    }
                });
            }
        } else {
            // Create new
            await tx.ledgerEntry.create({
                data: {
                    date: order?.date ?? new Date(),
                    description: `Order snapshot — ${desired.label}`,
                    sourceTransactionId,
                    accountId: desired.accountId,
                    debit: desired.debit,
                    credit: desired.credit,
                    businessId: order?.businessId ?? null,
                    snapshotId,
                    postingGroup,
                    entryNumber,
                }
            });
        }
    }

    // Delete any existing entries that were not matched (obsolete)
    const toDeleteIds = existingEntries.filter(e => !matchedExistingIds.has(e.id)).map(e => e.id);
    if (toDeleteIds.length > 0) {
        await tx.ledgerEntry.deleteMany({
            where: { id: { in: toDeleteIds } }
        });
    }
}

export async function recomputeOrderFinancialSnapshot(
    orderId: string,
    options?: { tx?: Prisma.TransactionClient }
) {
    const runner = async (tx: Prisma.TransactionClient) => {
        const order = await tx.order.findUnique({
            where: { id: orderId },
            include: { products: true },
        });
        if (!order) throw new Error('Order not found');

        const computed = await computeSnapshot(tx, order);
        const snapshot = await tx.orderFinancialSnapshot.upsert({
            where: { orderId },
            update: {
                businessId: order.businessId ?? null,
                statusAtSnapshot: String(computed.status || ''),
                revenue: computed.revenue,
                cogs: computed.cogs,
                courierExpense: computed.courierExpense,
                courierReceivable: computed.courierReceivable,
                courierPayable: computed.courierPayable,
                cashReceived: computed.cashReceived,
                returnFeeRevenue: computed.returnFeeRevenue,
                netProfit: computed.netProfit,
                cogsEstimated: computed.cogsEstimated,
                computedAt: new Date(),
            },
            create: {
                orderId,
                businessId: order.businessId ?? null,
                statusAtSnapshot: String(computed.status || ''),
                revenue: computed.revenue,
                cogs: computed.cogs,
                courierExpense: computed.courierExpense,
                courierReceivable: computed.courierReceivable,
                courierPayable: computed.courierPayable,
                cashReceived: computed.cashReceived,
                returnFeeRevenue: computed.returnFeeRevenue,
                netProfit: computed.netProfit,
                cogsEstimated: computed.cogsEstimated,
                computedAt: new Date(),
            },
        });

        await postLedgerEntries(tx, {
            order,
            snapshotId: snapshot.id,
            postingGroup: `order:${orderId}:snapshot`,
            data: computed,
        });

        return snapshot;
    };

    if (options?.tx) return runner(options.tx);
    return prisma.$transaction((tx) => runner(tx));
}

export async function recordOrderPaymentEvent(params: {
    orderId: string;
    eventType: 'AdvanceReceived' | 'ShippingPaid' | 'Refund';
    amount: number;
    accountId?: string | null;
}) {
    const amount = dbMath.norm(params.amount);
    if (amount <= 0) return null;

    return prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
            where: { id: params.orderId },
            select: { id: true, orderNumber: true, businessId: true },
        });
        if (!order) throw new Error('Order not found');

        const index = await buildAccountIndex(tx);
        const cashAccountId = params.accountId ?? resolveAccount(index, ACCOUNT_LABELS.cash);
        const advanceAccountId = resolveAccount(index, ACCOUNT_LABELS.customerAdvance);

        // Enforce cash drawer validation
        if (cashAccountId) {
            const acct = await tx.account.findUnique({ where: { id: cashAccountId }, select: { name: true } });
            if (acct && acct.name.toLowerCase().includes('cash')) {
                const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
                await assertCashDrawerAccount(cashAccountId);
            }
        }

        const event = await tx.orderPaymentEvent.create({
            data: {
                orderId: params.orderId,
                businessId: order.businessId ?? null,
                eventType: params.eventType,
                amount,
                accountId: cashAccountId,
            },
        });

        const entries =
            params.eventType === 'Refund'
                ? [
                    { accountId: advanceAccountId, debit: amount, credit: 0 },
                    { accountId: cashAccountId, debit: 0, credit: amount },
                ]
                : [
                    { accountId: cashAccountId, debit: amount, credit: 0 },
                    { accountId: advanceAccountId, debit: 0, credit: amount },
                ];

        const entryNumber = await resolveLedgerEntryNumber(tx, {
            postingGroup: `order:${order.id}:payment:${event.id}`,
            date: new Date(),
        });

        await tx.ledgerEntry.createMany({
            data: entries.map((entry) => ({
                date: new Date(),
                description: `${params.eventType} for ${order.orderNumber || order.id}`,
                sourceTransactionId: order.id,
                accountId: entry.accountId,
                debit: entry.debit,
                credit: entry.credit,
                businessId: order.businessId ?? null,
                postingGroup: `order:${order.id}:payment:${event.id}`,
                entryNumber,
            })),
        });

        return event;
    });
}
