import prisma from '@/lib/prisma';
import { randomBytes } from 'crypto';
import type { PurchaseType as AppPurchaseType, GeneralOrderItem, ThreePieceOrderItem, PaymentDetails, PurchasePaymentItem } from '@/types';
import { Prisma, PurchaseType as PrismaPurchaseType, PaymentStatus, ProductionStepType, CheckStatus, PurchaseOrderStatus } from '@prisma/client';
import { revalidateTags } from '../utils/revalidate';
import { format, startOfDay, endOfDay } from 'date-fns';
import { getActorName } from '../utils/current-user';
import { ACCOUNT_LABELS, ensureDefaultAccounts, resolveLedgerEntryNumber } from './accounting';
import { sendPurchaseStatusSms } from './sms-notifications';
import { getPurchaseOrderById } from '@/services/purchases';
import { buildCheckPassingItemFromPurchasePayment, upsertCheckPassingItem, deleteCheckPassingItem } from './check-passing-items';
import { CheckPassingSource } from '@prisma/client';
import { assertNotPreCutoff } from './cutoff';

const STEP_TYPES: ProductionStepType[] = ['FABRIC', 'PRINTING', 'CUTTING', 'FINISHING'];

async function verifyPoNotPreCutoff(poId: string) {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { date: true } });
    if (po) await assertNotPreCutoff(po.date);
}

type FabricLotAllocationInput = {
    part: 'JAMA' | 'ORNA' | 'SELOWAR';
    inventoryItemId: string;
    yards: number;
};

type ThreePieceItemInput = ThreePieceOrderItem & {
    lotAllocations?: FabricLotAllocationInput[];
};

type CreatePurchaseOrderPayload = {
    type: AppPurchaseType;
    supplierId?: string;
    items: GeneralOrderItem[] | ThreePieceItemInput[];
    payments: PurchasePaymentItem[];
    printingVendorId?: string;
    pindiOfFab?: number | null;
    fabricSource?: 'INTERNAL' | 'EXTERNAL';
    fabricInventoryId?: string | null;
};

function mapStatusByTotals(totalCost: number, totalPaid: number): PaymentStatus {
    if (totalPaid <= 0) return 'Unpaid';
    if (totalPaid >= totalCost) return 'Paid';
    return 'Partial';
}

function resolvePurchaseErrorMessage(error: any, fallback: string) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
            const field = String(error.meta?.field_name || '');
            if (field.includes('InventoryMovement_reference_fkey')) {
                return 'Internal stock movement failed due to invalid reference. Please retry.';
            }
            return 'Database reference error. Please retry.';
        }
        if (error.code === 'P2025') {
            return 'Required record not found. Please refresh and try again.';
        }
    }
    if (typeof error?.message === 'string') {
        return error.message;
    }
    return fallback;
}

const calculateAvailableQty = (quantity?: number | null, reserved?: number | null) =>
    Math.max((Number(quantity) || 0) - (Number(reserved) || 0), 0);

async function getAvailableQtyTx(
    tx: Prisma.TransactionClient,
    productId: string,
    variantId?: string | null
) {
    const items = await tx.inventoryItem.findMany({
        where: { productId, variantId: variantId ?? null },
        select: { quantity: true, reservedQuantity: true },
    });
    return items.reduce((sum: number, item: any) => sum + calculateAvailableQty(item.quantity, item.reservedQuantity), 0);
}

async function maybeTriggerStockStatusSyncByTotals(
    productId: string,
    variantId: string | null,
    beforeTotal: number,
    afterTotal: number
) {
    const crossingZero = (beforeTotal > 0 && afterTotal <= 0) || (beforeTotal <= 0 && afterTotal > 0);
    if (!crossingZero) return;
    try {
        // Skip inventory-triggered sync in publish mode
        const { getGeneralSettings } = await import('../utils/app-settings');
        const settings = await getGeneralSettings();
        if (settings.stockSyncMode === 'publish') {
            console.log('[STOCK_SYNC_SKIP] Publish mode active, skipping inventory-triggered sync');
            return;
        }
        const { triggerStockStatusSync } = await import('./stock-sync');
        await triggerStockStatusSync(productId, variantId ?? null, true);
    } catch (err) {
        console.error('[STOCK_SYNC_TRIGGER_ERROR]', err);
    }
}

async function syncStepPaidFromPaymentsTx(tx: Prisma.TransactionClient, poId: string) {
    const [payments, steps] = await Promise.all([
        tx.purchasePayment.findMany({ where: { poId } }),
        tx.productionStep.findMany({
            where: { poId },
            include: {
                PurchaseOrder: {
                    include: { PurchaseOrderItem: true }
                }
            }
        }),
    ]);

    const stepTypeById = new Map(steps.map((s) => [s.id, s.stepType]));
    const paidMap = new Map<string, number>(); // stepId -> amount

    for (const pay of payments) {
        if (!pay.productionStepId) continue;
        const checkAmt = (pay.check || 0) > 0 && pay.checkStatus === 'Passed' ? pay.check : 0;
        const amt = (pay.cash || 0) + checkAmt;
        paidMap.set(pay.productionStepId, (paidMap.get(pay.productionStepId) || 0) + amt);
    }

    await Promise.all(
        steps.map((step: any) => {
            const paidAmount = paidMap.get(step.id) ?? 0;

            // Recompute step-level paymentStatus
            let stepTotal = 0;
            const items = step.PurchaseOrder.PurchaseOrderItem;
            if (step.stepType === 'PRINTING') {
                stepTotal = items.reduce((s: number, item: any) => s + ((item.quantity || 0) * (item.printingCost || 0)), 0);
            } else if (step.stepType === 'CUTTING') {
                stepTotal = items.reduce((s: number, item: any) => {
                    const billable = Math.max(0, (item.quantity || 0) - (item.printingDamagedQty || 0) - (item.cuttingDamagedQty || 0));
                    return s + (billable * (item.cuttingCost || 0));
                }, 0);
            } else if (step.stepType === 'FABRIC') {
                stepTotal = step.costAmount || 0;
            }

            const status: PaymentStatus = stepTotal > 0
                ? (paidAmount >= (stepTotal - 0.01) ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Unpaid'))
                : 'Paid';

            return tx.productionStep.update({
                where: { id: step.id },
                data: { paidAmount, paymentStatus: status } as any,
            });
        })
    );
}

async function recomputePaymentStatusTx(tx: Prisma.TransactionClient, poId: string) {
    const po = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        include: { ProductionStep: true, PurchasePayment: true, FabricLotUsage: true },
    });
    if (!po) return;

    const steps = po.ProductionStep || [];
    const payments = po.PurchasePayment || [];
    const usesInternalFabric = (po.FabricLotUsage?.length || 0) > 0;

    // Total cost of all steps (fabric + printing + cutting + etc)
    const totalCostValue = po.total;

    // Total paid across all payments related to this PO
    const totalPaidValue = payments.reduce((sum, p) => {
        const checkAmt = (p.check || 0) > 0 && p.checkStatus === 'Passed' ? p.check : 0;
        return sum + (p.cash || 0) + checkAmt;
    }, 0);

    const internalFabricBuffer = usesInternalFabric ? 0 : 0; // Legacy logic handled this differently

    const nextStatus = mapStatusByTotals(totalCostValue, totalPaidValue);

    await tx.purchaseOrder.update({
        where: { id: poId },
        data: { paymentStatus: nextStatus },
    });

    // Also sync the individual steps if they are linked to payments
    await syncStepPaidFromPaymentsTx(tx, poId);
}

export async function createPurchaseOrderCore(payload: CreatePurchaseOrderPayload): Promise<{ success: boolean; message?: string; poId?: string; }> {
    const { type, supplierId, items, printingVendorId, pindiOfFab, fabricSource } = payload;
    const prismaPurchaseType: PrismaPurchaseType = type === 'three-piece' ? 'three_piece' : 'general';
    const paidAmount = 0; // Inline payments disabled
    const actor = await getActorName('Admin');
    const usingInternal = type === 'three-piece' && fabricSource === 'INTERNAL';

    if (type === 'three-piece' && fabricSource === 'EXTERNAL') {
        return { success: false, message: 'External fabric source is no longer supported. Please use Internal Inventory.' };
    }

    if (!supplierId && !usingInternal) {
        return { success: false, message: 'Supplier and at least one item are required.' };
    }
    if (!items || items.length === 0) {
        return { success: false, message: 'At least one item is required.' };
    }

    try {
        const today = new Date();
        // Ensure standard accounts exist and get IDs
        await ensureDefaultAccounts();
        const accounts = await prisma.account.findMany({ select: { id: true, name: true } });
        const accountMap = new Map(accounts.map((a) => [a.name, a.id]));
        const apId = accountMap.get(ACCOUNT_LABELS.accountsPayable) || accountMap.get('Accounts Payable');
        const inventoryAccountId = accountMap.get(ACCOUNT_LABELS.inventory) || accountMap.get('Inventory');
        const wipId = accountMap.get(ACCOUNT_LABELS.wip) || accountMap.get('Work In Progress');

        if (!apId || !inventoryAccountId) {
            throw new Error('Critical accounts (AP or Inventory) missing.');
        }

        const result = await prisma.$transaction(async (tx) => {
            // Generate day-based short ID: DDMMYY-01/02/...
            const todayStart = startOfDay(today);
            const todayEnd = endOfDay(today);
            const countToday = await tx.purchaseOrder.count({
                where: { date: { gte: todayStart, lte: todayEnd } },
            });
            const seq = String(countToday + 1).padStart(2, '0');
            const poId = `${format(today, 'ddMMyy')}-${seq}`;

            let totalCost = 0;
            let totalYards = 0;
            const itemCreations: any[] = [];
            let internalLotAllocations: Array<{
                itemId: string;
                part: 'JAMA' | 'ORNA' | 'SELOWAR';
                inventoryItemId: string;
                yards: number;
                unitCost: number;
            }> = [];

            if (type === 'general') {
                const generalItems = items as GeneralOrderItem[];
                totalCost = generalItems.reduce((acc, item) => acc + (Number(item.lineTotal) || ((Number(item.quantity) || 0) * (Number(item.unitCost) || 0))), 0);
                generalItems.forEach(item => {
                    itemCreations.push({
                        productId: item.productId,
                        variantId: item.variantId || null,
                        quantity: item.quantity,
                        unitCost: item.unitCost,
                        finalQty: null,
                        pindaCount: item.pindaCount,
                        pindaBreakdown: item.pindaQuantities,
                    });
                });
            } else { // 'three-piece'
                const threePieceItems = items as ThreePieceItemInput[];
                const variantIds = Array.from(
                    new Set(threePieceItems.map((item) => item.variantId).filter((id): id is string => Boolean(id)))
                );
                const variantRows = variantIds.length
                    ? await tx.productVariant.findMany({
                        where: { id: { in: variantIds } },
                        select: { id: true, productId: true },
                    })
                    : [];
                const variantProductMap = new Map(variantRows.map((row) => [row.id, row.productId]));
                if (usingInternal) {
                    const allocations = threePieceItems.flatMap((item: ThreePieceItemInput) =>
                        (item.lotAllocations || []).map((alloc: FabricLotAllocationInput) => ({
                            itemId: item.id,
                            part: alloc.part,
                            inventoryItemId: alloc.inventoryItemId,
                            yards: Math.max(0, Number(alloc.yards) || 0),
                        }))
                    );

                    if (allocations.length === 0) {
                        throw new Error('Lot allocations are required for internal fabric usage.');
                    }

                    const lotIds = Array.from(new Set(allocations.map((a) => a.inventoryItemId)));
                    const lotRows = await tx.inventoryItem.findMany({ where: { id: { in: lotIds } } });
                    const lotMap = new Map(lotRows.map((lot) => [lot.id, lot]));
                    const poItemCostCache = new Map<string, number>();

                    const resolveLotUnitCost = async (lot: (typeof lotRows)[number]) => {
                        const existing = Number(lot.unitCost) || 0;
                        if (existing > 0) return existing;
                        const lotNumber = lot.lotNumber || '';
                        if (!lotNumber.startsWith('PO-')) return 0;
                        const poId = lotNumber.replace(/^PO-/, '');
                        const key = `${poId}:${lot.productId}:${lot.variantId ?? 'none'}`;
                        if (poItemCostCache.has(key)) return poItemCostCache.get(key) || 0;
                        const poItem = await tx.purchaseOrderItem.findFirst({
                            where: { poId, productId: lot.productId, variantId: lot.variantId ?? null },
                            select: { unitCost: true },
                        });
                        const cost = Number(poItem?.unitCost) || 0;
                        poItemCostCache.set(key, cost);
                        if (cost > 0) {
                            await tx.inventoryItem.update({
                                where: { id: lot.id },
                                data: { unitCost: cost, updatedAt: new Date() },
                            });
                        }
                        return cost;
                    };

                    const perItemTotals = new Map<string, Record<'JAMA' | 'ORNA' | 'SELOWAR', { yards: number; cost: number }>>();

                    for (const alloc of allocations) {
                        const lot = lotMap.get(alloc.inventoryItemId);
                        if (!lot) throw new Error('Selected fabric lot not found.');
                        const unitCost = await resolveLotUnitCost(lot);
                        const bucket = perItemTotals.get(alloc.itemId) || {
                            JAMA: { yards: 0, cost: 0 },
                            ORNA: { yards: 0, cost: 0 },
                            SELOWAR: { yards: 0, cost: 0 },
                        };
                        bucket[alloc.part as 'JAMA' | 'ORNA' | 'SELOWAR'].yards += alloc.yards;
                        bucket[alloc.part as 'JAMA' | 'ORNA' | 'SELOWAR'].cost += alloc.yards * unitCost;
                        perItemTotals.set(alloc.itemId, bucket);
                        internalLotAllocations.push({
                            itemId: alloc.itemId,
                            part: alloc.part,
                            inventoryItemId: alloc.inventoryItemId,
                            yards: alloc.yards,
                            unitCost,
                        });
                    }

                    threePieceItems.forEach((item) => {
                        const plannedQty = Number(item.quantity) || 0;
                        const resolvedProductId = item.variantId && variantProductMap.get(item.variantId)
                            ? variantProductMap.get(item.variantId)!
                            : item.productId;
                        if (!resolvedProductId) {
                            throw new Error('Product selection is required for every item.');
                        }
                        const inputJama = Number(item.jamaYards) || 0;
                        const inputOrna = Number(item.ornaYards) || 0;
                        const inputSelowar = Number(item.selowarYards) || 0;
                        const hasInput = inputJama > 0 || inputOrna > 0 || inputSelowar > 0;
                        const totals = perItemTotals.get(item.id) || {
                            JAMA: { yards: 0, cost: 0 },
                            ORNA: { yards: 0, cost: 0 },
                            SELOWAR: { yards: 0, cost: 0 },
                        };
                        const requiredJama = hasInput ? plannedQty * inputJama : totals.JAMA.yards;
                        const requiredOrna = hasInput ? plannedQty * inputOrna : totals.ORNA.yards;
                        const requiredSelowar = hasInput ? plannedQty * inputSelowar : totals.SELOWAR.yards;

                        const tolerance = 0.01;
                        if (hasInput && (
                            Math.abs(totals.JAMA.yards - requiredJama) > tolerance ||
                            Math.abs(totals.ORNA.yards - requiredOrna) > tolerance ||
                            Math.abs(totals.SELOWAR.yards - requiredSelowar) > tolerance
                        )) {
                            throw new Error('Allocated yards must exactly match Jama/Orna/Selowar yards for each item.');
                        }

                        const jamaRate = totals.JAMA.yards > 0 ? totals.JAMA.cost / totals.JAMA.yards : 0;
                        const ornaRate = totals.ORNA.yards > 0 ? totals.ORNA.cost / totals.ORNA.yards : 0;
                        const selowarRate = totals.SELOWAR.yards > 0 ? totals.SELOWAR.cost / totals.SELOWAR.yards : 0;

                        totalCost += totals.JAMA.cost + totals.ORNA.cost + totals.SELOWAR.cost;
                        totalYards += requiredJama + requiredOrna + requiredSelowar;

                        itemCreations.push({
                            id: item.id,
                            productId: resolvedProductId,
                            variantId: item.variantId || null,
                            quantity: plannedQty,
                            finalQty: plannedQty,
                            unitCost: 0,
                            jamaYards: requiredJama,
                            jamaRate,
                            ornaYards: requiredOrna,
                            ornaRate,
                            selowarYards: requiredSelowar,
                            selowarRate,
                            printingCost: 0,
                            cuttingCost: 0,
                        });
                    });
                } else {
                    totalCost = threePieceItems.reduce((acc, item) => {
                        const jama = (Number(item.jamaYards) || 0) * (Number(item.jamaRate) || 0);
                        const orna = (Number(item.ornaYards) || 0) * (Number(item.ornaRate) || 0);
                        const selowar = (Number(item.selowarYards) || 0) * (Number(item.selowarRate) || 0);
                        return acc + jama + orna + selowar;
                    }, 0);
                    totalYards = threePieceItems.reduce((acc, item) => {
                        return acc + (Number(item.jamaYards) || 0) + (Number(item.ornaYards) || 0) + (Number(item.selowarYards) || 0);
                    }, 0);
                    threePieceItems.forEach(item => {
                        const plannedQty = Number(item.quantity) || 0;
                        const resolvedProductId = item.variantId && variantProductMap.get(item.variantId)
                            ? variantProductMap.get(item.variantId)!
                            : item.productId;
                        if (!resolvedProductId) {
                            throw new Error('Product selection is required for every item.');
                        }
                        itemCreations.push({
                            productId: resolvedProductId,
                            variantId: item.variantId || null,
                            quantity: plannedQty,
                            finalQty: plannedQty,
                            unitCost: 0,
                            jamaYards: Number(item.jamaYards) || 0,
                            jamaRate: Number(item.jamaRate) || 0,
                            ornaYards: Number(item.ornaYards) || 0,
                            ornaRate: Number(item.ornaRate) || 0,
                            selowarYards: Number(item.selowarYards) || 0,
                            selowarRate: Number(item.selowarRate) || 0,
                            printingCost: 0,
                            cuttingCost: 0,
                        });
                    });
                }
            }

            const itemsCount = items.reduce((acc, item) => {
                const qty = Number((item as any).quantity) || 0;
                return acc + qty;
            }, 0);

            let resolvedSupplierId = supplierId || '';
            if (usingInternal && !resolvedSupplierId) {
                const internalSupplier = await tx.supplier.upsert({
                    where: { name: 'Internal Stock' },
                    update: {},
                    create: {
                        name: 'Internal Stock',
                        contactPerson: 'System',
                        email: 'internal@local',
                        phone: '',
                        address: 'Internal Stock',
                    },
                });
                resolvedSupplierId = internalSupplier.id;
            }

            if (usingInternal && internalLotAllocations.length > 0) {
                const requiredByLot = internalLotAllocations.reduce((map, alloc) => {
                    map.set(alloc.inventoryItemId, (map.get(alloc.inventoryItemId) || 0) + alloc.yards);
                    return map;
                }, new Map<string, number>());

                const lotIds = Array.from(requiredByLot.keys());
                const lotRows = await tx.inventoryItem.findMany({ where: { id: { in: lotIds } } });
                const lotMap = new Map(lotRows.map((lot) => [lot.id, lot]));
                for (const lotId of lotIds) {
                    const lot = lotMap.get(lotId);
                    if (!lot) {
                        throw new Error('Selected fabric lot not found.');
                    }
                    const required = requiredByLot.get(lotId) || 0;
                    if (lot.quantity < required) {
                        throw new Error(`Insufficient internal fabric stock for lot ${lot.lotNumber}. Required ${required} yds, available ${lot.quantity} yds.`);
                    }
                }
            }

            const newPurchaseOrder = await tx.purchaseOrder.create({
                data: {
                    id: poId,
                    supplierId: resolvedSupplierId,
                    date: today,
                    status: type === 'three-piece' ? 'FabricOrdered' : 'Draft',
                    paymentStatus: totalCost === 0 ? 'Paid' : 'Unpaid',
                    total: totalCost,
                    type: prismaPurchaseType,
                    items: itemsCount,
                    finalReceivedQty: 0,
                    currentStep: type === 'three-piece' ? 'FABRIC' : 'PLANNING',
                    PurchaseOrderItem: {
                        create: itemCreations,
                    },
                }
            });

            await tx.purchaseOrder.update({
                where: { id: poId },
                data: {
                    PurchaseOrderLog: {
                        create: {
                            status: type === 'three-piece' ? 'FabricOrdered' : 'Draft',
                            description: 'Purchase Order created.',
                            user: actor,
                        }
                    }
                }
            });

            // --- LEDGER ENTRIES ---
            const entryNumber = await resolveLedgerEntryNumber(tx, { date: today });

            // 1. Booking the Invoice (Dr Inventory, Cr AP)
            if (usingInternal) {
                // Internal Fabric: Dr WIP, Cr Inventory(Fabric)
                if (wipId && inventoryAccountId) {
                    await tx.ledgerEntry.createMany({
                        data: [
                            {
                                id: `cm${randomBytes(11).toString('hex')}`,
                                date: today,
                                entryNumber,
                                description: `Internal Fabric Consumption PO #${poId}`,
                                sourceTransactionId: poId,
                                accountId: wipId,
                                debit: totalCost,
                                credit: 0
                            },
                            {
                                id: `cm${randomBytes(11).toString('hex')}`,
                                date: today,
                                entryNumber,
                                description: `Internal Fabric Consumption PO #${poId}`,
                                sourceTransactionId: poId,
                                accountId: inventoryAccountId,
                                debit: 0,
                                credit: totalCost
                            }
                        ],
                        skipDuplicates: true
                    });
                }
            } else {
                // External: Dr Inventory, Cr AP
                await tx.ledgerEntry.createMany({
                    data: [
                        {
                            id: `cm${randomBytes(11).toString('hex')}`,
                            date: today,
                            entryNumber,
                            description: `PO Invoice #${poId}`,
                            sourceTransactionId: poId,
                            accountId: inventoryAccountId,
                            debit: totalCost,
                            credit: 0
                        },
                        {
                            id: `cm${randomBytes(11).toString('hex')}`,
                            date: today,
                            entryNumber,
                            description: `PO Invoice #${poId}`,
                            sourceTransactionId: poId,
                            accountId: apId,
                            debit: 0,
                            credit: totalCost
                        }
                    ],
                    skipDuplicates: true
                });
            }

            // 2. Booking the Payments (DELETED - Moved to Partner Profile)
            /*
            if (payments.length > 0) {
                ...
            }
            */

            if (type === 'three-piece') {
                // Initialize 4 production steps immediately (so we can link payments + vendors)
                const [fabricStep, printingStep, cuttingStep, finishingStep] = await Promise.all([
                    tx.productionStep.create({
                        data: {
                            poId,
                            stepType: 'FABRIC',
                            costAmount: totalCost,
                            pindiOfFab: pindiOfFab ?? null,
                            inputQty: totalYards,
                            fabricInventoryId: null,
                        }
                    }),
                    tx.productionStep.create({ data: { poId, stepType: 'PRINTING', vendorId: printingVendorId || null } }),
                    tx.productionStep.create({ data: { poId, stepType: 'CUTTING' } }),
                    tx.productionStep.create({ data: { poId, stepType: 'FINISHING' } }),
                ]);

                if (usingInternal && internalLotAllocations.length > 0) {
                    const requiredByLot = internalLotAllocations.reduce((map, alloc) => {
                        map.set(alloc.inventoryItemId, (map.get(alloc.inventoryItemId) || 0) + alloc.yards);
                        return map;
                    }, new Map<string, number>());

                    const lotIds = Array.from(requiredByLot.keys());
                    const lotRows = await tx.inventoryItem.findMany({ where: { id: { in: lotIds } } });
                    const lotMap = new Map(lotRows.map((lot) => [lot.id, lot]));

                    for (const lotId of lotIds) {
                        const lot = lotMap.get(lotId);
                        if (!lot) throw new Error('Selected fabric lot not found.');
                        const required = requiredByLot.get(lotId) || 0;
                        if (required <= 0) continue;
                        const beforeTotal = await getAvailableQtyTx(tx, lot.productId, lot.variantId ?? null);
                        const prevQty = lot.quantity;
                        const prevAvailable = calculateAvailableQty(prevQty, lot.reservedQuantity);
                        const updated = await tx.inventoryItem.update({
                            where: { id: lotId },
                            data: { quantity: { decrement: required }, updatedAt: new Date() },
                        });
                        const nextAvailable = calculateAvailableQty(updated.quantity, lot.reservedQuantity);
                        const afterTotal = Math.max(beforeTotal - prevAvailable + nextAvailable, 0);

                        await tx.inventoryMovement.create({
                            data: {
                                inventoryItemId: updated.id,
                                type: 'Adjusted',
                                quantityChange: -required,
                                balance: updated.quantity,
                                notes: `Fabric used for PO #${poId}`,
                                user: actor,
                            },
                        });

                        await maybeTriggerStockStatusSyncByTotals(
                            lot.productId,
                            lot.variantId ?? null,
                            beforeTotal,
                            afterTotal
                        );
                    }

                    await tx.fabricLotUsage.createMany({
                        data: internalLotAllocations.map((alloc) => ({
                            id: `cm${randomBytes(11).toString('hex')}`,
                            poId,
                            itemId: alloc.itemId,
                            part: alloc.part,
                            inventoryItemId: alloc.inventoryItemId,
                            yards: alloc.yards,
                            unitCost: alloc.unitCost,
                            updatedAt: new Date()
                        })),
                    });
                }

                // (Payments were deleted from here)
            }
            return newPurchaseOrder;
        });

        await revalidateTags(['purchases']);
        
        // --- Fire Partner Bill SMS ---
        try {
            const { sendPartnerBillSms } = await import('./sms-notifications');
            const supplier = await prisma.supplier.findUnique({ where: { id: result.supplierId } });
            if (supplier) {
                const billAmount = Number(result.total) || 0;
                const nextDue = await getSupplierDueBalance(result.supplierId);
                const previousDue = Math.max(0, nextDue - billAmount);
                await sendPartnerBillSms({
                    partnerId: result.supplierId,
                    partnerType: 'SUPPLIER',
                    partnerName: supplier.name,
                    partnerPhone: supplier.phone,
                    billAmount,
                    previousDue,
                    nextDue,
                });
            }
        } catch (e) {
            console.error('[SMS_TRIGGER_ERROR_PARTNER_BILL]', e);
        }
        // -----------------------------

        return { success: true, poId: result.id };

    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:createPurchaseOrder]', error);
        return { success: false, message: resolvePurchaseErrorMessage(error, 'Failed to create purchase order.') };
    }
}

export type ReceivePurchaseOrderPayload = {
    purchaseOrderId: string;
    locationId: string;
    items: Array<{
        itemId: string;
        quantity: number;
        wastageQty?: number;
        pindaBreakdown?: number[];
    }>;
    user?: string;
};

export async function receivePurchaseOrderStockCore(payload: ReceivePurchaseOrderPayload) {
    const { purchaseOrderId, locationId, items, user } = payload;
    if (!purchaseOrderId) return { success: false, message: 'purchaseOrderId is required.' };
    await verifyPoNotPreCutoff(purchaseOrderId);
    if (!locationId) return { success: false, message: 'locationId is required.' };
    if (!Array.isArray(items) || items.length === 0) return { success: false, message: 'At least one item is required.' };

    try {
        await prisma.$transaction(async (tx) => {
            const stockLocation = await tx.stockLocation.findUnique({
                where: { id: locationId },
                select: { id: true, name: true },
            });
            if (!stockLocation) {
                throw new Error('Invalid stock location. Please select a valid location and try again.');
            }

            const po = await tx.purchaseOrder.findUnique({
                where: { id: purchaseOrderId },
                include: { PurchaseOrderItem: { include: { product: { include: { comboItems: true } } } } }
            });

            if (!po) throw new Error('Purchase Order not found.');

            let currentTransactionReceivedTotal = 0;
            let currentTransactionWastageTotal = 0;

            // Global roll index for this transaction
            const canonicalLotPrefix = `PO-${po.id}-R`;
            const existingRolls = await tx.inventoryItem.findMany({
                where: { lotNumber: { startsWith: canonicalLotPrefix } },
                select: { lotNumber: true }
            });
            let maxRollIdx = 0;
            const existingRollNums = new Set<string>();
            for (const roll of existingRolls) {
                if (roll.lotNumber) {
                    existingRollNums.add(roll.lotNumber);
                }
                const match = roll.lotNumber.match(/-R(\d+)$/);
                if (match) {
                    const idx = parseInt(match[1], 10);
                    if (idx > maxRollIdx) maxRollIdx = idx;
                }
            }
            let nextRollIdx = maxRollIdx + 1;
            const reserveNextRollNumber = () => {
                let rollNum = `${canonicalLotPrefix}${nextRollIdx}`;
                while (existingRollNums.has(rollNum)) {
                    nextRollIdx += 1;
                    rollNum = `${canonicalLotPrefix}${nextRollIdx}`;
                }
                existingRollNums.add(rollNum);
                nextRollIdx += 1;
                return rollNum;
            };

            for (const item of items) {
                const poItem = po.PurchaseOrderItem.find((pi) => pi.id === item.itemId);
                if (!poItem) throw new Error(`Item ${item.itemId} not found in this PO.`);

                const qtyToReceive = Math.max(0, item.quantity);
                const qtyWastage = Math.max(0, item.wastageQty || 0);

                if (qtyToReceive === 0 && qtyWastage === 0) continue;

                // Validation: receive + wastage <= remaining
                const currentlyReceived = poItem.receivedQty || 0;
                const currentlyWasted = poItem.generalWastageQty || 0;
                const remaining = poItem.quantity - (currentlyReceived + currentlyWasted);

                if (qtyToReceive + qtyWastage > remaining) {
                    throw new Error(`Cannot receive/waste ${qtyToReceive + qtyWastage} for product ID ${poItem.productId}. Maximum remaining is ${remaining}.`);
                }

                currentTransactionReceivedTotal += qtyToReceive;
                currentTransactionWastageTotal += qtyWastage;

                // Resolve effective pinda breakdown for this receive action.
                // If user didn't provide breakdown, but PO item has one and it matches qtyToReceive,
                // use it to generate unique rolls. Otherwise, require explicit breakdown.
                const inputBreakdown = Array.isArray(item.pindaBreakdown)
                    ? item.pindaBreakdown.map((n) => Number(n) || 0).filter((n) => n > 0)
                    : [];
                const storedBreakdown = Array.isArray((poItem as any).pindaBreakdown)
                    ? (poItem as any).pindaBreakdown.map((n: any) => Number(n) || 0).filter((n: number) => n > 0)
                    : [];
                let effectiveBreakdown = inputBreakdown;
                if (qtyToReceive > 0 && effectiveBreakdown.length === 0 && storedBreakdown.length > 0) {
                    const storedTotal = storedBreakdown.reduce((a: number, b: number) => a + b, 0);
                    if (storedTotal === qtyToReceive) {
                        effectiveBreakdown = storedBreakdown;
                    } else {
                        throw new Error(
                            `Pinda breakdown required for ${poItem.productId} (${poItem.variantId ?? 'no-variant'}). ` +
                            `This PO item has a saved breakdown totaling ${storedTotal}, but you are receiving ${qtyToReceive}. ` +
                            `Open the Roll/Pinda dialog and set the breakdown for this receive.`
                        );
                    }
                }

                // Update PO Item counts
                await tx.purchaseOrderItem.update({
                    where: { id: poItem.id },
                    data: {
                        receivedQty: { increment: qtyToReceive },
                        generalWastageQty: { increment: qtyWastage },
                        pindaBreakdown: inputBreakdown.length > 0 ? inputBreakdown : undefined,
                    }
                });

                // Inventory Updates (Only for good stock)
                if (qtyToReceive > 0) {
                    const isCombo = (poItem as any).product?.productType === 'combo' || (poItem as any).product?.productType === 'Combo';
                    // We only want to generate inventory for children if Combo
                    const targets = isCombo && (poItem as any).product?.comboItems?.length > 0
                        ? (poItem as any).product.comboItems.map((ci: any) => ({
                            productId: ci.childId,
                            variantId: ci.variantId || null,
                        }))
                        : [{ productId: poItem.productId, variantId: poItem.variantId ?? null }];

                    const childCount = Math.max(1, targets.length);
                    const unitCostPerChild = isCombo ? (Number(poItem.unitCost) || 0) / childCount : (Number(poItem.unitCost) || 0);

                    if (effectiveBreakdown.length > 0) {
                        for (const target of targets) {
                            for (const pindaQty of effectiveBreakdown) {
                                if (pindaQty <= 0) continue;
                                const rollLotNum = reserveNextRollNumber();
                                const beforeTotal = await getAvailableQtyTx(tx, target.productId, target.variantId ?? null);
                                const createdItem = await tx.inventoryItem.create({
                                    data: {
                                        id: `cm${randomBytes(11).toString('hex')}`,
                                        productId: target.productId,
                                        locationId: locationId,
                                        variantId: target.variantId ?? null,
                                        quantity: pindaQty,
                                        unitCost: unitCostPerChild,
                                        lotNumber: rollLotNum,
                                        receivedDate: new Date(),
                                        updatedAt: new Date()
                                    }
                                });
                                const nextAvailable = calculateAvailableQty(createdItem.quantity, createdItem.reservedQuantity);
                                const afterTotal = Math.max(beforeTotal + nextAvailable, 0);
                                await maybeTriggerStockStatusSyncByTotals(target.productId, target.variantId ?? null, beforeTotal, afterTotal);
                                await tx.inventoryMovement.create({
                                    data: {
                                        inventoryItemId: createdItem.id,
                                        type: 'Received',
                                        quantityChange: pindaQty,
                                        balance: createdItem.quantity,
                                        notes: `Roll ${rollLotNum} from PO #${purchaseOrderId}${isCombo ? ' (Combo child)' : ''}`,
                                        user: user || 'System',
                                    }
                                });
                            }
                        }
                    } else {
                        // No pinda breakdown: create exactly one roll for this product in this receive action
                        for (const target of targets) {
                            const rollLotNum = reserveNextRollNumber();
                            const beforeTotal = await getAvailableQtyTx(tx, target.productId, target.variantId ?? null);
                            const createdItem = await tx.inventoryItem.create({
                                data: {
                                    id: `cm${randomBytes(11).toString('hex')}`,
                                    productId: target.productId,
                                    locationId: locationId,
                                    variantId: target.variantId ?? null,
                                    quantity: qtyToReceive,
                                    unitCost: unitCostPerChild,
                                    lotNumber: rollLotNum,
                                    receivedDate: new Date(),
                                    updatedAt: new Date()
                                }
                            });
                            const nextAvailable = calculateAvailableQty(createdItem.quantity, createdItem.reservedQuantity);
                            const afterTotal = Math.max(beforeTotal + nextAvailable, 0);
                            await maybeTriggerStockStatusSyncByTotals(
                                target.productId,
                                target.variantId ?? null,
                                beforeTotal,
                                afterTotal
                            );
                            await tx.inventoryMovement.create({
                                data: {
                                    inventoryItemId: createdItem.id,
                                    type: 'Received',
                                    quantityChange: qtyToReceive,
                                    balance: createdItem.quantity,
                                    notes: `Roll ${rollLotNum} from PO #${purchaseOrderId}${isCombo ? ' (Combo child)' : ''}`,
                                    user: user || 'System',
                                }
                            });
                        }
                    }
                }
            }

            // Check if ALL items are fully covered (received + wasted >= ordered)
            const freshPo = await tx.purchaseOrder.findUnique({
                where: { id: purchaseOrderId },
                include: { PurchaseOrderItem: true }
            });
            if (!freshPo) throw new Error('Refetch PO failed.');

            const currentTotalReceivedAcrossPO = freshPo.PurchaseOrderItem.reduce((sum: number, i: any) => sum + i.receivedQty, 0);
            const currentTotalWastageAcrossPO = freshPo.PurchaseOrderItem.reduce((sum: number, i: any) => sum + i.generalWastageQty, 0);

            const allItemsFullyReceived = freshPo.PurchaseOrderItem.every(
                (i) => (i.receivedQty + i.generalWastageQty) >= i.quantity
            );

            // Determine Status
            const nextStatus: PurchaseOrderStatus = allItemsFullyReceived ? 'Received' : 'PartialReceived';
            const isCompleted = allItemsFullyReceived;

            // --- Cost Reallocation Logic (On Full Completion) ---
            if (isCompleted && currentTotalWastageAcrossPO > 0) {
                // Goal: PO Total Bill is fixed.
                const poTotal = freshPo.total;

                // 1. Calculate weighted "good value" using base unit costs
                let totalBaseGoodValue = 0;
                freshPo.PurchaseOrderItem.forEach(item => {
                    const goodQty = item.receivedQty;
                    const baseCost = item.unitCost;
                    totalBaseGoodValue += (goodQty * baseCost);
                });

                if (totalBaseGoodValue > 0) {
                    // 2. Distribute PO Total proportionally to "Good Value"
                    let distributedTotal = 0;
                    const updates = [];
                    let lastValidItemIndex = -1;

                    for (let i = 0; i < freshPo.PurchaseOrderItem.length; i++) {
                        const item = freshPo.PurchaseOrderItem[i];
                        if (item.receivedQty > 0) lastValidItemIndex = i;
                    }

                    for (let i = 0; i < freshPo.PurchaseOrderItem.length; i++) {
                        const item = freshPo.PurchaseOrderItem[i];
                        if (item.receivedQty <= 0) continue;

                        const baseVal = item.receivedQty * item.unitCost;
                        const share = baseVal / totalBaseGoodValue;
                        let allocatedAmount = poTotal * share;

                        allocatedAmount = Math.round(allocatedAmount * 100) / 100;

                        if (i === lastValidItemIndex) {
                            const diff = poTotal - (distributedTotal + allocatedAmount);
                            allocatedAmount += diff;
                        }

                        distributedTotal += allocatedAmount;
                        const newUnitCost = allocatedAmount / item.receivedQty;

                        if (Math.abs(newUnitCost - item.unitCost) > 0.001) {
                            updates.push({
                                itemId: item.id,
                                newUnitCost,
                                oldUnitCost: item.unitCost,
                                productId: item.productId,
                                variantId: item.variantId
                            });
                        }
                    }

                    // 3. Apply Updates
                    for (const up of updates) {
                        await tx.purchaseOrderItem.update({
                            where: { id: up.itemId },
                            data: { unitCost: up.newUnitCost }
                        });

                        const canonicalLotNumber = `PO-${freshPo.id}`;
                        const inventoryItems = await tx.inventoryItem.findMany({
                            where: {
                                productId: up.productId,
                                variantId: up.variantId,
                                OR: [
                                    { lotNumber: canonicalLotNumber },
                                    { lotNumber: freshPo.id }
                                ]
                            }
                        });

                        for (const inv of inventoryItems) {
                            await tx.inventoryItem.update({
                                where: { id: inv.id },
                                data: { unitCost: up.newUnitCost }
                            });

                            await tx.inventoryMovement.create({
                                data: {
                                    inventoryItemId: inv.id,
                                    type: 'Adjusted',
                                    quantityChange: 0,
                                    balance: inv.quantity,
                                    notes: `Cost Reallocation: Wastage absorbed. ${up.oldUnitCost.toFixed(2)} -> ${up.newUnitCost.toFixed(2)}`,
                                    user: user || 'System',
                                }
                            });
                        }
                    }
                }
            }

            await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: {
                    status: nextStatus,
                    currentStep: isCompleted ? 'COMPLETED' : undefined,
                    finalReceivedQty: currentTotalReceivedAcrossPO,
                    PurchaseOrderLog: {
                        create: {
                            status: nextStatus,
                            description: `Received ${currentTransactionReceivedTotal}, Wasted ${currentTransactionWastageTotal}. (Total Rec: ${currentTotalReceivedAcrossPO}, Waste: ${currentTotalWastageAcrossPO}).`,
                            user: user || 'System',
                        }
                    }
                }
            });
        });

        await revalidateTags(['purchases', 'inventory']);
        sendPurchaseStatusSms(purchaseOrderId).catch((err) => console.error('[SMS_PO_RECEIVE_ERROR]', err));
        return { success: true };

    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:receivePurchaseOrderStock]', error);
        return { success: false, message: error.message || 'Failed to receive stock.' };
    }
}


type UpsertPaymentPayload = {
    purchaseOrderId: string;
    paymentFor: 'General' | 'FABRIC' | 'PRINTING' | 'CUTTING' | 'FINISHING' | 'Fabric' | 'Printing' | 'Cutting';
    cash?: number;
    check?: number;
    checkDate?: string;
    checkStatus?: 'Pending' | 'Passed' | 'Bounced' | 'Cancelled';
    vendorId?: string;
    productionStepId?: string;
    physicalInvoiceUrl?: string;
    paidFromAccountId?: string;
    paymentMethod?: string;
    user?: string;
    checkNo?: string;
};

export async function upsertPurchasePaymentCore(payload: UpsertPaymentPayload): Promise<{ success: boolean; message?: string; purchaseOrder?: any; }> {
    const { purchaseOrderId, paymentFor, cash, check, checkDate, checkStatus, vendorId, productionStepId, physicalInvoiceUrl, paidFromAccountId, paymentMethod, checkNo } = payload;
    const actor = payload.user || await getActorName('Admin');
    await verifyPoNotPreCutoff(purchaseOrderId);

    try {
        if ((check || 0) > 0 && (!checkDate || !payload.checkNo)) {
            throw new Error('Check payment requires a check number and passing date.');
        }

        if (paidFromAccountId) {
            const account = await prisma.account.findUnique({ where: { id: paidFromAccountId } });
            if (account && account.name.toLowerCase().includes('cash')) {
                const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
                try {
                    await assertCashDrawerAccount(paidFromAccountId);
                } catch (err: any) {
                    throw new Error(err.message === 'CASH_DRAWER_INACTIVE' ? 'Selected Cash Drawer is inactive.' : 'Cash payments must specify a valid Cash Drawer.');
                }
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            const normalizePaymentFor = (val: UpsertPaymentPayload['paymentFor']) => {
                if (val === 'Fabric') return 'FABRIC';
                if (val === 'Printing') return 'PRINTING';
                if (val === 'Cutting') return 'CUTTING';
                return val;
            };

            const paymentForKey = normalizePaymentFor(paymentFor);
            const legacyKeys = paymentForKey === 'FABRIC' ? ['Fabric'] : paymentForKey === 'PRINTING' ? ['Printing'] : paymentForKey === 'CUTTING' ? ['Cutting'] : [];

            const existing = await tx.purchasePayment.findFirst({
                where: { poId: purchaseOrderId, paymentFor: { in: [paymentForKey, ...legacyKeys] } },
            });

            let linkedProductionStepId = productionStepId || existing?.productionStepId || null;
            if (!linkedProductionStepId && STEP_TYPES.includes(paymentForKey as ProductionStepType)) {
                const step = await tx.productionStep.findFirst({
                    where: { poId: purchaseOrderId, stepType: paymentForKey as ProductionStepType },
                    select: { id: true },
                });
                linkedProductionStepId = step?.id || null;
            }

            const paymentData = {
                cash: cash !== undefined ? cash : (existing?.cash ?? 0),
                check: check !== undefined ? check : (existing?.check ?? 0),
                checkDate: (check !== undefined && check > 0) ? (checkDate ? new Date(checkDate) : null) : (check === 0 ? null : (existing?.checkDate || null)),
                checkStatus: (check !== undefined && check > 0) ? (checkStatus || existing?.checkStatus || 'Pending') : (check === 0 ? null : (existing?.checkStatus || null)),
                // @ts-ignore
                checkNo: (check !== undefined && check > 0) ? (payload.checkNo || (existing as any)?.checkNo || null) : (check === 0 ? null : ((existing as any)?.checkNo || null)), // ADDED
                vendorId: vendorId || existing?.vendorId || null,
                productionStepId: linkedProductionStepId,
                physicalInvoiceUrl: physicalInvoiceUrl ?? existing?.physicalInvoiceUrl ?? null,
                paidFromAccountId: paidFromAccountId || existing?.paidFromAccountId || null,
                paymentMethod: paymentMethod || existing?.paymentMethod || null,
            };

            let paymentRecord: any = null;
            if (existing) {
                try {
                    paymentRecord = await tx.purchasePayment.update({
                        where: { id: existing.id },
                        data: { ...paymentData, paymentFor: paymentForKey },
                    });
                } catch (err: any) {
                    const msg = err?.message || '';
                    if (msg.includes('productionStepId')) {
                        paymentRecord = await tx.purchasePayment.update({
                            where: { id: existing.id },
                            data: { ...paymentData, paymentFor: paymentForKey, productionStepId: undefined as any },
                        });
                    } else {
                        throw err;
                    }
                }
            } else {
                const data = {
                    poId: purchaseOrderId,
                    paymentFor: paymentForKey,
                    ...paymentData,
                };
                try {
                    paymentRecord = await tx.purchasePayment.create({ data });
                } catch (err: any) {
                    const msg = err?.message || '';
                    if (msg.includes('productionStepId')) {
                        const { productionStepId, ...rest } = data;
                        paymentRecord = await tx.purchasePayment.create({ data: rest });
                    } else {
                        throw err;
                    }
                }
            }

            if (paymentRecord) {
                const checkItem = await buildCheckPassingItemFromPurchasePayment(tx, paymentRecord.id);
                if (checkItem) await upsertCheckPassingItem(tx, checkItem);
                else await deleteCheckPassingItem(tx, CheckPassingSource.Purchase, paymentRecord.id);

                await ensureDefaultAccounts();
                const accounts = await tx.account.findMany({ select: { id: true, name: true } });
                const accountIndex = new Map(accounts.map((acc) => [acc.name.toLowerCase(), acc.id]));
                const apId = accountIndex.get(ACCOUNT_LABELS.accountsPayable.toLowerCase());
                const cashAccountId =
                    paymentRecord.paidFromAccountId ||
                    accountIndex.get(ACCOUNT_LABELS.cash.toLowerCase());
                const checkAmt = (paymentRecord.check > 0 && paymentRecord.checkStatus === 'Passed') ? paymentRecord.check : 0;
                const paidTotal = (paymentRecord.cash || 0) + checkAmt;

                const postingGroup = `purchasePayment:${paymentRecord.id}`;

                await tx.ledgerEntry.deleteMany({
                    where: { postingGroup },
                });

                if (apId && cashAccountId && paidTotal > 0) {
                    const description = `Purchase payment (${paymentForKey}) for PO #${purchaseOrderId}`;
                    const ledgerDate =
                        paymentRecord.check > 0 && paymentRecord.checkDate
                            ? paymentRecord.checkDate
                            : new Date();
                    const entryNumber = await resolveLedgerEntryNumber(tx, {
                        postingGroup,
                        date: ledgerDate,
                    });
                    await tx.ledgerEntry.createMany({
                        data: [
                            {
                                date: ledgerDate,
                                description,
                                sourceTransactionId: paymentRecord.id,
                                accountId: apId!,
                                debit: paidTotal,
                                credit: 0,
                                businessId: null,
                                postingGroup,
                                entryNumber,
                            },
                            {
                                date: ledgerDate,
                                description,
                                sourceTransactionId: paymentRecord.id,
                                accountId: cashAccountId,
                                debit: 0,
                                credit: paidTotal,
                                businessId: null,
                                postingGroup,
                                entryNumber,
                            },
                        ],
                        skipDuplicates: true,
                    });
                }
            }

            await syncStepPaidFromPaymentsTx(tx, purchaseOrderId);
            await recomputePaymentStatusTx(tx, purchaseOrderId);

            const actionDesc = physicalInvoiceUrl ? `Invoice uploaded` : `Payment updated`;
            const updatedPo = await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: {
                    updatedAt: new Date(), // ADDED
                    PurchaseOrderLog: {
                        create: {
                            status: 'Draft',
                            description: `${actionDesc} for ${paymentFor}.`,
                            user: actor,
                        },
                    },
                },
                include: {
                    PurchaseOrderItem: { include: { product: true, ProductVariant: true } },
                    PurchasePayment: true,
                    Supplier: true,
                    PurchaseOrderLog: { orderBy: { timestamp: 'desc' as any } },
                    ProductionStep: { include: { Vendor: true } },
                }
            });
            return updatedPo;
        });

        await revalidateTags(['purchases']);
        // The transaction returns the PO now.
        return { success: true, purchaseOrder: result };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:upsertPurchasePayment]', error);
        return { success: false, message: error.message || 'Failed to update payment.' };
    }
}


export { syncStepPaidFromPaymentsTx, recomputePaymentStatusTx };

export async function getPendingPurchaseChecksCore() {
    try {
        const payments = await prisma.purchasePayment.findMany({
            where: { checkStatus: 'Pending', check: { gt: 0 } },
            orderBy: { checkDate: 'asc' },
            include: {
                Vendor: true,
                PurchaseOrder: true,
                ProductionStep: true,
            },
        });
        return payments;
    } catch (error) {
        console.error('[SERVER_CORE_ERROR:getPendingPurchaseChecks]', error);
        return [];
    }
}

export async function updateCheckStatusCore(payload: { paymentId: string; status: CheckStatus; user?: string }) {
    const { paymentId, status } = payload;
    const actor = payload.user || await getActorName('Admin');
    try {
        const payment = await prisma.purchasePayment.update({
            where: { id: paymentId },
            data: { checkStatus: status },
            include: { PurchaseOrder: true },
        });
        await verifyPoNotPreCutoff(payment.poId);

        const checkItem = await buildCheckPassingItemFromPurchasePayment(prisma, payment.id);
        if (checkItem) await upsertCheckPassingItem(prisma, checkItem);
        else await deleteCheckPassingItem(prisma, CheckPassingSource.Purchase, payment.id);

        await prisma.purchaseOrder.update({
            where: { id: payment.poId },
            data: {
                PurchaseOrderLog: {
                    create: {
                        status: payment.PurchaseOrder.status,
                        description: `Check marked as ${status}`,
                        user: actor,
                    },
                },
            },
        });

        // 1. Sync paid amounts on steps
        await syncStepPaidFromPaymentsTx(prisma, payment.poId);
        // 2. Recompute PO status
        await recomputePaymentStatusTx(prisma, payment.poId);

        // 3. Update Ledger
        // If Passed: Create ledger entries (Dr AP, Cr Bank)
        // If Not Passed (Pending/Bounced/Cancelled): Reverse ledger entries
        await prisma.$transaction(async (tx) => {
            const postingGroup = `purchasePayment:${paymentId}`;

            const fullPayment = await tx.purchasePayment.findUnique({ where: { id: paymentId } });
            if (!fullPayment || !fullPayment.check || fullPayment.check <= 0) return;

            // 1. Resolve Accounts
            await ensureDefaultAccounts();
            const accounts = await tx.account.findMany({ select: { id: true, name: true } });
            const accountIndex = new Map(accounts.map((acc) => [acc.name.toLowerCase(), acc.id]));
            const apId = accountIndex.get(ACCOUNT_LABELS.accountsPayable.toLowerCase());
            const supplierAdvanceId = accountIndex.get(ACCOUNT_LABELS.supplierAdvance.toLowerCase());
            const sourceAccountId = fullPayment.paidFromAccountId || accountIndex.get(ACCOUNT_LABELS.cash.toLowerCase());

            if (!apId || !supplierAdvanceId || !sourceAccountId) return;

            // 2. Detect if this payment was staged in Supplier Advance (FIFO flow)
            // We check existing entries before deletion. A staged payment has Dr Supplier Advance.
            const existingEntries = await tx.ledgerEntry.findMany({
                where: { postingGroup },
                select: { accountId: true, debit: true }
            });

            // FIFO logic in applyPartnerPaymentCore posts to Supplier Advance.
            // Direct PO add/edit does NOT post anything for Pending checks.
            // So detection via existing entries works for Passed -> Pending transition (restoring staging).
            // But for Pending -> Passed, we need to know if it *is* a FIFO payment.
            const isPartnerFifoPayment = fullPayment.paymentFor === 'Purchase Balance (FIFO)' || (fullPayment.paymentFor || '').startsWith('Production Step (');
            const hadPendingAdvanceStage = existingEntries.some(e => e.accountId === supplierAdvanceId && e.debit > 0) || isPartnerFifoPayment;

            // 3. safe delete old entries
            await tx.ledgerEntry.deleteMany({ where: { postingGroup } });

            // 4. Rebuild based on new status
            const entryNumber = await resolveLedgerEntryNumber(tx, { date: new Date(), postingGroup });
            const commonData = {
                date: new Date(),
                entryNumber,
                description: `PO Check ${status} #${fullPayment.poId}`,
                sourceTransactionId: fullPayment.id,
                postingGroup
            };

            if (status === 'Passed') {
                if (hadPendingAdvanceStage) {
                    // Path A: FIFO Origin. It was sitting in Supplier Advance.
                    // Action: Move from Supplier Advance to AP.
                    // Dr Accounts Payable, Cr Supplier Advance
                    await tx.ledgerEntry.createMany({
                        data: [
                            { ...commonData, accountId: apId, debit: fullPayment.check, credit: 0 },
                            { ...commonData, accountId: supplierAdvanceId, debit: 0, credit: fullPayment.check }
                        ]
                    });
                } else {
                    // Path B: Direct PO Add. It was NOT staged (no ledger entry for Pending).
                    // Action: Pay AP directly from Bank.
                    // Dr Accounts Payable, Cr Bank/Cash
                    await tx.ledgerEntry.createMany({
                        data: [
                            { ...commonData, accountId: apId, debit: fullPayment.check, credit: 0 },
                            { ...commonData, accountId: sourceAccountId, debit: 0, credit: fullPayment.check }
                        ]
                    });
                }
            } else if (status === 'Pending') {
                if (hadPendingAdvanceStage) {
                    // Path A: FIFO Origin. It should go back to waiting in Supplier Advance.
                    // Action: Re-stage.
                    // Dr Supplier Advance, Cr Bank/Cash
                    await tx.ledgerEntry.createMany({
                        data: [
                            { ...commonData, accountId: supplierAdvanceId, debit: fullPayment.check, credit: 0 },
                            { ...commonData, accountId: sourceAccountId, debit: 0, credit: fullPayment.check }
                        ]
                    });
                }
                // Path B: Direct PO Add. Pending means no ledger effect. Do nothing.
            }
            // Status Bounced/Cancelled: Do nothing (entries deleted).
        });

        await revalidateTags(['purchases']);
        return { success: true };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:updateCheckStatus]', error);
        return { success: false, message: error.message || 'Failed to update check status.' };
    }
}

// -----------------------------
// Three-piece workflow helpers
// -----------------------------

function computeFabricCostFromItem(item: {
    jamaYards?: number | null;
    jamaRate?: number | null;
    ornaYards?: number | null;
    ornaRate?: number | null;
    selowarYards?: number | null;
    selowarRate?: number | null;
    FabricLotUsage?: Array<{ yards: number; unitCost: number }> | null;
}) {
    let cost = 0;
    if (item.FabricLotUsage && item.FabricLotUsage.length > 0) {
        cost = item.FabricLotUsage.reduce((sum, usage) => sum + (Number(usage.yards) || 0) * (Number(usage.unitCost) || 0), 0);
    }
    const jama = (Number(item.jamaYards) || 0) * (Number(item.jamaRate) || 0);
    const orna = (Number(item.ornaYards) || 0) * (Number(item.ornaRate) || 0);
    const selowar = (Number(item.selowarYards) || 0) * (Number(item.selowarRate) || 0);
    return Math.max(cost, jama + orna + selowar);
}

function computeTotalYardsFromItem(item: {
    jamaYards?: number | null;
    ornaYards?: number | null;
    selowarYards?: number | null;
}) {
    return (Number(item.jamaYards) || 0) + (Number(item.ornaYards) || 0) + (Number(item.selowarYards) || 0);
}

export type UpdateThreePieceFabricPlanningPayload = {
    purchaseOrderId: string;
    printingVendorId?: string | null;
    pindiOfFab?: number | null;
    fabricSource?: 'INTERNAL' | 'EXTERNAL';
    fabricInventoryId?: string | null;
    items: Array<{
        id: string;
        productId?: string;
        variantId?: string | null;
        quantity: number;
        // fabric (yards + rate)
        jamaYards: number;
        jamaRate: number;
        ornaYards: number;
        ornaRate: number;
        selowarYards: number;
        selowarRate: number;
        lotAllocations?: FabricLotAllocationInput[];
    }>;
    user?: string;
};

export async function updateThreePieceFabricPlanningCore(payload: UpdateThreePieceFabricPlanningPayload) {
    const { purchaseOrderId, printingVendorId, pindiOfFab, items, fabricSource } = payload;
    const actor = payload.user || await getActorName('Admin');
    if (!purchaseOrderId) return { success: false, message: 'purchaseOrderId is required.' };
    await verifyPoNotPreCutoff(purchaseOrderId);
    if (!Array.isArray(items) || items.length === 0) return { success: false, message: 'At least one item is required.' };

    try {
        let touchedInventory = false;
        const updated = await prisma.$transaction(async (tx) => {
            const po = await tx.purchaseOrder.findUnique({
                where: { id: purchaseOrderId },
                include: { PurchaseOrderItem: true, ProductionStep: true },
            });
            if (!po) throw new Error('Purchase Order not found.');
            if (po.type !== 'three_piece') throw new Error('This action is only valid for three-piece purchases.');

            const existingUsages = await tx.fabricLotUsage.findMany({
                where: { poId: purchaseOrderId },
            });

            if (fabricSource === 'EXTERNAL') {
                throw new Error('External fabric source is not supported.');
            }

            const normalizedSource: 'INTERNAL' | 'EXTERNAL' = 'INTERNAL';

            let fabricTotal = 0;
            let totalYards = 0;
            let itemsCount = 0;

            const fabricStep = po.ProductionStep.find((s) => s.stepType === 'FABRIC');
            if (!fabricStep) throw new Error('FABRIC step not initialized.');

            const printingStep = po.ProductionStep.find((s) => s.stepType === 'PRINTING');
            if (!printingStep) throw new Error('PRINTING step not initialized.');

            const variantIds = Array.from(
                new Set(items.map((item) => item.variantId).filter((id): id is string => Boolean(id)))
            );
            const variantRows = variantIds.length
                ? await tx.productVariant.findMany({
                    where: { id: { in: variantIds } },
                    select: { id: true, productId: true },
                })
                : [];
            const variantProductMap = new Map(variantRows.map((row) => [row.id, row.productId]));

            if (normalizedSource === 'INTERNAL') {
                const allocations = items.flatMap((item) =>
                    (item.lotAllocations || []).map((alloc) => ({
                        itemId: item.id,
                        part: alloc.part,
                        inventoryItemId: alloc.inventoryItemId,
                        yards: Math.max(0, Number(alloc.yards) || 0),
                    }))
                );

                if (allocations.length === 0) {
                    throw new Error('Lot allocations are required for internal fabric usage.');
                }

                const lotIds = Array.from(new Set(allocations.map((a) => a.inventoryItemId)));
                const lotRows = await tx.inventoryItem.findMany({ where: { id: { in: lotIds } } });
                const lotMap = new Map(lotRows.map((lot) => [lot.id, lot]));
                const poItemCostCache = new Map<string, number>();

                const resolveLotUnitCost = async (lot: (typeof lotRows)[number]) => {
                    const existing = Number(lot.unitCost) || 0;
                    if (existing > 0) return existing;
                    const lotNumber = lot.lotNumber || '';
                    if (!lotNumber.startsWith('PO-')) return 0;
                    const poId = lotNumber.replace(/^PO-/, '');
                    const key = `${poId}:${lot.productId}:${lot.variantId ?? 'none'}`;
                    if (poItemCostCache.has(key)) return poItemCostCache.get(key) || 0;
                    const poItem = await tx.purchaseOrderItem.findFirst({
                        where: { poId, productId: lot.productId, variantId: lot.variantId ?? null },
                        select: { unitCost: true },
                    });
                    const cost = Number(poItem?.unitCost) || 0;
                    poItemCostCache.set(key, cost);
                    if (cost > 0) {
                        await tx.inventoryItem.update({
                            where: { id: lot.id },
                            data: { unitCost: cost, updatedAt: new Date() },
                        });
                    }
                    return cost;
                };

                const perItemTotals = new Map<string, Record<'JAMA' | 'ORNA' | 'SELOWAR', { yards: number; cost: number }>>();
                const newUsageMap = new Map<string, { itemId: string; part: 'JAMA' | 'ORNA' | 'SELOWAR'; inventoryItemId: string; yards: number; unitCost: number }>();

                for (const alloc of allocations) {
                    const lot = lotMap.get(alloc.inventoryItemId);
                    if (!lot) throw new Error('Selected fabric lot not found.');
                    const unitCost = await resolveLotUnitCost(lot);
                    const bucket = perItemTotals.get(alloc.itemId) || {
                        JAMA: { yards: 0, cost: 0 },
                        ORNA: { yards: 0, cost: 0 },
                        SELOWAR: { yards: 0, cost: 0 },
                    };
                    const allocated = (items.find(i => i.id === alloc.itemId)?.lotAllocations || []).filter(a => a.part === alloc.part).reduce((sum: number, alloc: FabricLotAllocationInput) => sum + (Number(alloc.yards) || 0), 0);
                    bucket[alloc.part].yards += alloc.yards;
                    bucket[alloc.part].cost += alloc.yards * unitCost;
                    perItemTotals.set(alloc.itemId, bucket);
                    const key = `${alloc.itemId}:${alloc.part}:${alloc.inventoryItemId}`;
                    newUsageMap.set(key, {
                        itemId: alloc.itemId,
                        part: alloc.part,
                        inventoryItemId: alloc.inventoryItemId,
                        yards: alloc.yards,
                        unitCost,
                    });
                }

                await Promise.all(
                    items.map(async (it) => {
                        const inputJama = Number(it.jamaYards) || 0;
                        const inputOrna = Number(it.ornaYards) || 0;
                        const inputSelowar = Number(it.selowarYards) || 0;
                        const hasInput = inputJama > 0 || inputOrna > 0 || inputSelowar > 0;
                        const totals = perItemTotals.get(it.id) || {
                            JAMA: { yards: 0, cost: 0 },
                            ORNA: { yards: 0, cost: 0 },
                            SELOWAR: { yards: 0, cost: 0 },
                        };
                        const requiredJama = hasInput ? inputJama : totals.JAMA.yards;
                        const requiredOrna = hasInput ? inputOrna : totals.ORNA.yards;
                        const requiredSelowar = hasInput ? inputSelowar : totals.SELOWAR.yards;

                        const diffJama = Math.abs(totals.JAMA.yards - requiredJama);
                        const diffOrna = Math.abs(totals.ORNA.yards - requiredOrna);
                        const diffSelowar = Math.abs(totals.SELOWAR.yards - requiredSelowar);
                        const tolerance = 0.01;

                        if (hasInput && (diffJama > tolerance || diffOrna > tolerance || diffSelowar > tolerance)) {
                            throw new Error('Allocated yards must match Jama/Orna/Selowar yards for each item.');
                        }
                        const existingItem = po.PurchaseOrderItem.find((item) => item.id === it.id);
                        const nextVariantId = typeof it.variantId !== 'undefined'
                            ? it.variantId ?? null
                            : existingItem?.variantId ?? null;
                        const resolvedProductId = nextVariantId && variantProductMap.get(nextVariantId)
                            ? variantProductMap.get(nextVariantId)!
                            : (it.productId || existingItem?.productId);
                        if (!resolvedProductId) {
                            throw new Error('Product selection is required for every item.');
                        }

                        const jamaRate = totals.JAMA.yards > 0 ? totals.JAMA.cost / totals.JAMA.yards : 0;
                        const ornaRate = totals.ORNA.yards > 0 ? totals.ORNA.cost / totals.ORNA.yards : 0;
                        const selowarRate = totals.SELOWAR.yards > 0 ? totals.SELOWAR.cost / totals.SELOWAR.yards : 0;

                        await tx.purchaseOrderItem.updateMany({
                            where: { id: it.id, poId: purchaseOrderId },
                            data: {
                                productId: resolvedProductId,
                                variantId: nextVariantId,
                                quantity: Number(it.quantity) || 0,
                                finalQty: Number(it.quantity) || 0,
                                jamaYards: requiredJama,
                                jamaRate,
                                ornaYards: requiredOrna,
                                ornaRate,
                                selowarYards: requiredSelowar,
                                selowarRate,
                            },
                        });

                    })
                );
                itemsCount = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
                fabricTotal = items.reduce((sum, it) => {
                    const totals = perItemTotals.get(it.id) || {
                        JAMA: { yards: 0, cost: 0 },
                        ORNA: { yards: 0, cost: 0 },
                        SELOWAR: { yards: 0, cost: 0 },
                    };
                    return sum + totals.JAMA.cost + totals.ORNA.cost + totals.SELOWAR.cost;
                }, 0);
                totalYards = items.reduce((sum, it) => {
                    const inputJama = Number(it.jamaYards) || 0;
                    const inputOrna = Number(it.ornaYards) || 0;
                    const inputSelowar = Number(it.selowarYards) || 0;
                    const hasInput = inputJama > 0 || inputOrna > 0 || inputSelowar > 0;
                    if (!hasInput) {
                        const totals = perItemTotals.get(it.id) || {
                            JAMA: { yards: 0 },
                            ORNA: { yards: 0 },
                            SELOWAR: { yards: 0 },
                        };
                        return sum + totals.JAMA.yards + totals.ORNA.yards + totals.SELOWAR.yards;
                    }
                    return sum + inputJama + inputOrna + inputSelowar;
                }, 0);

                const deltaByLot = new Map<string, number>();
                existingUsages.forEach((usage) => {
                    deltaByLot.set(usage.inventoryItemId, (deltaByLot.get(usage.inventoryItemId) || 0) + usage.yards);
                });
                newUsageMap.forEach((usage) => {
                    deltaByLot.set(usage.inventoryItemId, (deltaByLot.get(usage.inventoryItemId) || 0) - usage.yards);
                });

                for (const [lotId, delta] of deltaByLot.entries()) {
                    if (!delta) continue;
                    const lot = lotMap.get(lotId) || await tx.inventoryItem.findUnique({ where: { id: lotId } });
                    if (!lot) throw new Error('Selected fabric lot not found.');
                    const beforeTotal = await getAvailableQtyTx(tx, lot.productId, lot.variantId ?? null);
                    const prevQty = lot.quantity;
                    const nextQty = prevQty + delta;
                    if (nextQty < 0) throw new Error('Insufficient internal fabric stock.');
                    const updatedItem = await tx.inventoryItem.update({
                        where: { id: lotId },
                        data: { quantity: { increment: delta }, updatedAt: new Date() },
                    });
                    const prevAvailable = calculateAvailableQty(prevQty, lot.reservedQuantity);
                    const nextAvailable = calculateAvailableQty(updatedItem.quantity, lot.reservedQuantity);
                    const afterTotal = Math.max(beforeTotal - prevAvailable + nextAvailable, 0);
                    await tx.inventoryMovement.create({
                        data: {
                            inventoryItemId: updatedItem.id,
                            type: 'Adjusted',
                            quantityChange: delta,
                            balance: updatedItem.quantity,
                            notes: `Adjusted fabric usage for PO #${purchaseOrderId}`,
                            user: actor,
                        },
                    });
                    await maybeTriggerStockStatusSyncByTotals(
                        updatedItem.productId,
                        updatedItem.variantId ?? null,
                        beforeTotal,
                        afterTotal
                    );
                    touchedInventory = true;
                }

                await Promise.all(
                    existingUsages.map(async (usage) => {
                        const key = `${usage.itemId}:${usage.part}:${usage.inventoryItemId}`;
                        const updatedUsage = newUsageMap.get(key);
                        if (!updatedUsage || updatedUsage.yards <= 0) {
                            await tx.fabricLotUsage.delete({ where: { id: usage.id } });
                            return;
                        }
                        await tx.fabricLotUsage.update({
                            where: { id: usage.id },
                            data: { yards: updatedUsage.yards, unitCost: updatedUsage.unitCost, updatedAt: new Date() },
                        });
                        newUsageMap.delete(key);
                    })
                );

                if (newUsageMap.size > 0) {
                    await tx.fabricLotUsage.createMany({
                        data: Array.from(newUsageMap.values()).map((usage) => ({
                            poId: purchaseOrderId,
                            itemId: usage.itemId,
                            part: usage.part,
                            inventoryItemId: usage.inventoryItemId,
                            yards: usage.yards,
                            unitCost: usage.unitCost,
                            updatedAt: new Date(),
                        })),
                    });
                }
            } else {
                await Promise.all(
                    items.map((it) => {
                        const existingItem = po.PurchaseOrderItem.find((item) => item.id === it.id);
                        const nextVariantId = typeof it.variantId !== 'undefined'
                            ? it.variantId ?? null
                            : existingItem?.variantId ?? null;
                        const resolvedProductId = nextVariantId && variantProductMap.get(nextVariantId)
                            ? variantProductMap.get(nextVariantId)!
                            : (it.productId || existingItem?.productId);
                        if (!resolvedProductId) {
                            throw new Error('Product selection is required for every item.');
                        }
                        return tx.purchaseOrderItem.updateMany({
                            where: { id: it.id, poId: purchaseOrderId },
                            data: {
                                productId: resolvedProductId,
                                variantId: nextVariantId,
                                quantity: Number(it.quantity) || 0,
                                finalQty: Number(it.quantity) || 0,
                                jamaYards: Number(it.jamaYards) || 0,
                                jamaRate: Number(it.jamaRate) || 0,
                                ornaYards: Number(it.ornaYards) || 0,
                                ornaRate: Number(it.ornaRate) || 0,
                                selowarYards: Number(it.selowarYards) || 0,
                                selowarRate: Number(it.selowarRate) || 0,
                            },
                        });
                    })
                );

                fabricTotal = items.reduce((sum, it) => sum + computeFabricCostFromItem(it), 0);
                totalYards = items.reduce((sum, it) => sum + computeTotalYardsFromItem(it), 0);
                itemsCount = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);

                if (existingUsages.length > 0) {
                    const deltaByLot = new Map<string, number>();
                    existingUsages.forEach((usage) => {
                        deltaByLot.set(usage.inventoryItemId, (deltaByLot.get(usage.inventoryItemId) || 0) + usage.yards);
                    });
                    for (const [lotId, delta] of deltaByLot.entries()) {
                        if (!delta) continue;
                        const lot = await tx.inventoryItem.findUnique({ where: { id: lotId } });
                        if (!lot) continue;
                        const beforeTotal = await getAvailableQtyTx(tx, lot.productId, lot.variantId ?? null);
                        const prevQty = lot.quantity;
                        const prevAvailable = calculateAvailableQty(prevQty, lot.reservedQuantity);
                        const updatedItem = await tx.inventoryItem.update({
                            where: { id: lotId },
                            data: { quantity: { increment: delta }, updatedAt: new Date() },
                        });
                        const nextAvailable = calculateAvailableQty(updatedItem.quantity, lot.reservedQuantity);
                        const afterTotal = Math.max(beforeTotal - prevAvailable + nextAvailable, 0);
                        await tx.inventoryMovement.create({
                            data: {
                                inventoryItemId: updatedItem.id,
                                type: 'Adjusted',
                                quantityChange: delta,
                                balance: updatedItem.quantity,
                                notes: `Reverted fabric usage for PO #${purchaseOrderId}`,
                                user: actor,
                            },
                        });
                        await maybeTriggerStockStatusSyncByTotals(
                            updatedItem.productId,
                            updatedItem.variantId ?? null,
                            beforeTotal,
                            afterTotal
                        );
                        touchedInventory = true;
                    }
                    await tx.fabricLotUsage.deleteMany({ where: { poId: purchaseOrderId } });
                }
            }

            await tx.productionStep.update({
                where: { id: fabricStep.id },
                data: {
                    costAmount: fabricTotal,
                    inputQty: totalYards,
                    pindiOfFab: pindiOfFab ?? null,
                    fabricInventoryId: null,
                },
            });

            if (typeof printingVendorId !== 'undefined') {
                await tx.productionStep.update({
                    where: { id: printingStep.id },
                    data: { vendorId: printingVendorId || null },
                });
            }

            // Update PO totals
            await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: {
                    total: fabricTotal,
                    items: itemsCount,
                    PurchaseOrderLog: {
                        create: {
                            status: po.status,
                            description: `Fabric planning updated.`,
                            user: actor,
                        },
                    },
                },
            });

            await recomputePaymentStatusTx(tx, purchaseOrderId);

            return tx.purchaseOrder.findUnique({
                where: { id: purchaseOrderId },
                include: {
                    Supplier: true,
                    PurchaseOrderItem: { include: { product: true, ProductVariant: true } },
                    PurchaseOrderLog: { orderBy: { timestamp: 'desc' as any } },
                    PurchasePayment: { include: { Vendor: true, ProductionStep: true } },
                    ProductionStep: { include: { Vendor: true }, orderBy: { stepType: 'asc' as any } },
                },
            });
        });

        await revalidateTags(touchedInventory ? ['purchases', 'inventory'] : ['purchases']);
        return { success: true, purchaseOrder: updated };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:updateThreePieceFabricPlanning]', error);
        return { success: false, message: resolvePurchaseErrorMessage(error, 'Failed to update fabric planning.') };
    }
}

export type UpdateThreePieceStepCostsPayload = {
    purchaseOrderId: string;
    stepType: 'PRINTING' | 'CUTTING';
    damagedYards?: number;
    pindiOfFab?: number | null;
    vendorId?: string | null; // Updated to allow updating current step vendor
    nextVendorId?: string | null; // e.g. cutting vendor selected during printing
    cuttingType?: 'INTERNAL' | 'EXTERNAL';
    assignedStaffId?: string | null;
    items: Array<{ id: string; cost: number; damageQty?: number }>; // per variant/product line cost (total)
    user?: string;
    note?: string;
};

export async function updateThreePieceStepCostsCore(payload: UpdateThreePieceStepCostsPayload) {
    const { purchaseOrderId, stepType, damagedYards, pindiOfFab, vendorId, nextVendorId, cuttingType, assignedStaffId, items, note } = payload;
    const actor = payload.user || await getActorName('Admin');
    if (!purchaseOrderId) return { success: false, message: 'purchaseOrderId is required.' };
    await verifyPoNotPreCutoff(purchaseOrderId);
    if (!stepType) return { success: false, message: 'stepType is required.' };
    if (!Array.isArray(items) || items.length === 0) return { success: false, message: 'At least one item is required.' };

    try {
        const updated = await prisma.$transaction(async (tx) => {
            const po = await tx.purchaseOrder.findUnique({
                where: { id: purchaseOrderId },
                include: { PurchaseOrderItem: true, ProductionStep: true },
            });
            if (!po) throw new Error('Purchase Order not found.');
            if (po.type !== 'three_piece') throw new Error('This action is only valid for three-piece purchases.');

            const step = po.ProductionStep.find((s) => s.stepType === stepType);
            if (!step) throw new Error(`${stepType} step not initialized.`);

            // Update per-item costs and damage
            const costField = stepType === 'PRINTING' ? 'printingCost' : 'cuttingCost';
            const damageField = stepType === 'PRINTING' ? 'printingDamagedQty' : 'cuttingDamagedQty';

            await Promise.all(
                items.map((it) =>
                    tx.purchaseOrderItem.updateMany({
                        where: { id: it.id, poId: purchaseOrderId },
                        data: {
                            [costField]: Number(it.cost) || 0,
                            [damageField]: Number(it.damageQty) || 0,
                        } as any,
                    })
                )
            );
            const stepCostTotal = items.reduce((sum: number, it) => sum + (Number(it.cost) || 0), 0);
            // Calculate total damage from items if item damage is provided, else fallback (though UI sends 0 for fallback now)
            const calculatedDamagedQty = items.reduce((sum, it) => sum + (Number(it.damageQty) || 0), 0);
            // Always respect the calculated quantity from items (allowing 0), ignoring legacy/previous values
            const finalDamagedQty = calculatedDamagedQty;

            // Update step meta
            await tx.productionStep.update({
                where: { id: step.id },
                data: {
                    costAmount: stepCostTotal,
                    damagedQty: finalDamagedQty,
                    pindiOfFab: pindiOfFab ?? null,
                    cuttingType: cuttingType ?? undefined,
                    assignedStaffId: assignedStaffId ?? undefined,
                    note: typeof note === 'string' ? note : undefined,
                    vendorId: vendorId === undefined ? undefined : vendorId, // Update vendor if provided
                },
            });

            // --- Internal Cutting Staff Income upsert/delete ---
            if (stepType === 'CUTTING') {
                const uniqueKey = `PO:${purchaseOrderId}:CUTTING`;
                
                if (cuttingType === 'INTERNAL') {
                    if (!assignedStaffId) {
                        throw new Error('Internal cutting requires a Cutting Master assignment.');
                    }

                    // Enforce Cutting Master role
                    const staff = await tx.staffMember.findUnique({
                        where: { id: assignedStaffId },
                        select: { role: true }
                    });
                    if (!staff || staff.role !== 'CuttingMan') {
                        throw new Error('Assigned staff must be Cutting Master for internal cutting.');
                    }

                    const isInternal = true; // For clarity in logic below

                    // If staff changed, delete old entry for previous staff
                    if (step.assignedStaffId && step.assignedStaffId !== assignedStaffId) {
                        await tx.staffIncome.deleteMany({
                            where: { staffId: step.assignedStaffId, action: 'Cutting', notes: uniqueKey },
                        });
                    }

                    const existing = await tx.staffIncome.findFirst({
                        where: { staffId: assignedStaffId, action: 'Cutting', notes: uniqueKey },
                    });
                    if (existing) {
                        await tx.staffIncome.update({
                            where: { id: existing.id },
                            data: { amount: stepCostTotal },
                        });
                    } else {
                        await tx.staffIncome.create({
                            data: {
                                staffId: assignedStaffId,
                                action: 'Cutting',
                                amount: stepCostTotal,
                                notes: uniqueKey,
                            },
                        });
                    }
                } else {
                    // Not internal or no staff — delete stale entries
                    await tx.staffIncome.deleteMany({
                        where: { action: 'Cutting', notes: uniqueKey },
                    });
                }
            }

            // Allow selecting next vendor during the step (printing -> cutting)
            if (stepType === 'PRINTING' && typeof nextVendorId !== 'undefined') {
                const cuttingStep = po.ProductionStep.find((s) => s.stepType === 'CUTTING');
                if (cuttingStep) {
                    await tx.productionStep.update({
                        where: { id: cuttingStep.id },
                        data: { vendorId: nextVendorId || null },
                    });

                    // Post Step Cost Delta to Ledger (Dr WIP, Cr AP)
                    // Just for the delta cost.
                    const costDelta = stepCostTotal - (Number(step.costAmount) || 0);
                    if (costDelta !== 0) {
                        await ensureDefaultAccounts();
                        const accounts = await tx.account.findMany({ select: { id: true, name: true } });
                        const accountIndex = new Map(accounts.map((acc) => [acc.name.toLowerCase(), acc.id]));
                        const wipId = accountIndex.get(ACCOUNT_LABELS.wip.toLowerCase());
                        const apId = accountIndex.get(ACCOUNT_LABELS.accountsPayable.toLowerCase());

                        if (wipId && apId) {
                            const ledgerDate = new Date();
                            const entryNumber = await resolveLedgerEntryNumber(tx, { date: ledgerDate });
                            const description = `${stepType} Cost Adjustment PO #${purchaseOrderId}`;
                            // If positive delta: Cost increased. Dr WIP, Cr AP.
                            // If negative delta: Cost decreased. Dr AP, Cr WIP.

                            if (costDelta > 0) {
                                await tx.ledgerEntry.createMany({
                                    data: [
                                        { date: ledgerDate, entryNumber, description, sourceTransactionId: purchaseOrderId, accountId: wipId, debit: costDelta, credit: 0 },
                                        { date: ledgerDate, entryNumber, description, sourceTransactionId: purchaseOrderId, accountId: apId, debit: 0, credit: costDelta }
                                    ]
                                });
                            } else {
                                const absDelta = Math.abs(costDelta);
                                await tx.ledgerEntry.createMany({
                                    data: [
                                        { date: ledgerDate, entryNumber, description, sourceTransactionId: purchaseOrderId, accountId: apId, debit: absDelta, credit: 0 },
                                        { date: ledgerDate, entryNumber, description, sourceTransactionId: purchaseOrderId, accountId: wipId, debit: 0, credit: absDelta }
                                    ]
                                });
                            }
                        }
                    }
                }
            }

            // Recompute total (fabric + printing + cutting)
            const refreshedItems = await tx.purchaseOrderItem.findMany({
                where: { poId: purchaseOrderId },
                select: {
                    jamaYards: true,
                    jamaRate: true,
                    ornaYards: true,
                    ornaRate: true,
                    selowarYards: true,
                    selowarRate: true,
                    printingCost: true,
                    cuttingCost: true,
                },
            });

            const fabricTotal = refreshedItems.reduce((sum, it) => sum + computeFabricCostFromItem(it), 0);
            const printingTotal = refreshedItems.reduce((sum, it) => sum + (it.printingCost || 0), 0);
            const cuttingTotal = refreshedItems.reduce((sum, it) => sum + (it.cuttingCost || 0), 0);
            const total = fabricTotal + printingTotal + cuttingTotal;

            await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: {
                    total,
                    PurchaseOrderLog: {
                        create: {
                            status: po.status,
                            description: `${stepType} updated.`,
                            user: actor,
                        },
                    },
                },
            });

            await recomputePaymentStatusTx(tx, purchaseOrderId);

            return tx.purchaseOrder.findUnique({
                where: { id: purchaseOrderId },
                include: {
                    Supplier: true,
                    PurchaseOrderItem: { include: { product: true, ProductVariant: true } },
                    PurchaseOrderLog: { orderBy: { timestamp: 'desc' as any } },
                    PurchasePayment: { include: { Vendor: true, ProductionStep: true } },
                    ProductionStep: { include: { Vendor: true }, orderBy: { stepType: 'asc' as any } },
                },
            });
        });

        await revalidateTags(['purchases']);
        return { success: true, purchaseOrder: updated };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:updateThreePieceStepCosts]', error);
        return { success: false, message: error.message || 'Failed to update step.' };
    }
}

export type FinalizeThreePieceReceivingPayload = {
    purchaseOrderId: string;
    locationId: string;
    items: Array<{
        id: string;
        finalQty: number; // The target total production qty
        receivingNow: number; // Amount receiving in this batch
        // Optional rebalancing at final stage
        jamaYards?: number;
        jamaRate?: number;
        ornaYards?: number;
        ornaRate?: number;
        selowarYards?: number;
        selowarRate?: number;
        finishingWastageQty?: number;
    }>;
    user?: string;
};

export async function finalizeThreePieceReceivingCore(payload: FinalizeThreePieceReceivingPayload) {
    const { purchaseOrderId, locationId, items } = payload;
    const actor = payload.user || await getActorName('Admin');
    if (!purchaseOrderId || !locationId) return { success: false, message: 'purchaseOrderId and locationId are required.' };
    await verifyPoNotPreCutoff(purchaseOrderId);
    if (!Array.isArray(items) || items.length === 0) return { success: false, message: 'At least one item is required.' };

    try {
        const result = await prisma.$transaction(async (tx) => {
            const po = await tx.purchaseOrder.findUnique({
                where: { id: purchaseOrderId },
                include: { PurchaseOrderItem: { include: { product: true, ProductVariant: true } }, ProductionStep: true },
            });
            if (!po) throw new Error('Purchase Order not found.');
            if (po.type !== 'three_piece') throw new Error('This action is only valid for three-piece purchases.');
            if (po.status === 'Received') throw new Error('This Purchase Order has already been received.');

            const finishingStep = po.ProductionStep.find((s) => s.stepType === 'FINISHING');
            if (!finishingStep) throw new Error('FINISHING step not initialized.');

            // Update target quantities + optional fabric rebalance + finishing wastage
            await Promise.all(
                items.map((it) =>
                    tx.purchaseOrderItem.update({
                        where: { id: it.id, poId: purchaseOrderId },
                        data: {
                            finalQty: Number(it.finalQty) || 0,
                            receivedQty: { increment: Number(it.receivingNow) || 0 }, // Partial Receiving
                            finishingWastageQty: Number(it.finishingWastageQty) || 0,
                            jamaYards: typeof it.jamaYards === 'number' ? it.jamaYards : undefined,
                            jamaRate: typeof it.jamaRate === 'number' ? it.jamaRate : undefined,
                            ornaYards: typeof it.ornaYards === 'number' ? it.ornaYards : undefined,
                            ornaRate: typeof it.ornaRate === 'number' ? it.ornaRate : undefined,
                            selowarYards: typeof it.selowarYards === 'number' ? it.selowarYards : undefined,
                            selowarRate: typeof it.selowarRate === 'number' ? it.selowarRate : undefined,
                        } as any,
                    })
                )
            );

            const refreshedItems = await tx.purchaseOrderItem.findMany({
                where: { poId: purchaseOrderId },
                include: { product: true, ProductVariant: true, FabricLotUsage: true },
            });

            // Recompute fabric + total
            const fabricTotal = refreshedItems.reduce((sum, it) => sum + computeFabricCostFromItem(it), 0);
            const printingTotal = refreshedItems.reduce((sum, it) => sum + (it.printingCost || 0), 0);
            const cuttingTotal = refreshedItems.reduce((sum, it) => sum + (it.cuttingCost || 0), 0);
            const grandTotal = fabricTotal + printingTotal + cuttingTotal;

            // Update FABRIC step cost to match latest distribution
            const fabricStep = po.ProductionStep.find((s) => s.stepType === 'FABRIC');
            if (fabricStep) {
                const totalYards = refreshedItems.reduce((sum, it) => sum + computeTotalYardsFromItem(it), 0);
                await tx.productionStep.update({
                    where: { id: fabricStep.id },
                    data: { costAmount: fabricTotal, inputQty: totalYards },
                });
            }

            // Update FINISHING step wastage (sum of item wastage)
            const totalWastage = refreshedItems.reduce((sum, it) => sum + (Number(it.finishingWastageQty) || 0), 0);
            await tx.productionStep.update({
                where: { id: finishingStep.id },
                data: { wastageQty: totalWastage },
            });

            // Compute & persist per-unit cost per item
            // For three-piece, we use a blended cost (Grand Total / Total Final Quantity) to ensure consistency with summary cards
            const totalFinalQty = refreshedItems.reduce((sum, it) => sum + (Number(it.finalQty) || 0), 0);
            const blendedUnitCost = totalFinalQty > 0 ? grandTotal / totalFinalQty : 0;

            const unitCostByItemId = new Map<string, number>();
            for (const it of refreshedItems) {
                const itemUnitCost = blendedUnitCost; // All items in the production order share the same blended rate for the batch
                unitCostByItemId.set(it.id, itemUnitCost);
                await tx.purchaseOrderItem.update({
                    where: { id: it.id },
                    data: { unitCost: itemUnitCost },
                });
            }

            // Receive stock into lots
            const lotNumber = `PO-${purchaseOrderId}`;
            let batchTotalReceived = 0;
            let batchGrandValue = 0;

            for (const it of refreshedItems) {
                const payloadItem = items.find(pi => pi.id === it.id);
                const receivingNow = payloadItem?.receivingNow ?? 0;
                if (receivingNow <= 0) continue;

                batchTotalReceived += receivingNow;
                const itemUnitCost = unitCostByItemId.get(it.id) ?? it.unitCost ?? 0;
                batchGrandValue += receivingNow * itemUnitCost;

                const resolvedProductId = it.variantId && it.ProductVariant?.productId
                    ? it.ProductVariant.productId
                    : it.productId;

                if (resolvedProductId !== it.productId) {
                    await tx.purchaseOrderItem.update({
                        where: { id: it.id },
                        data: { productId: resolvedProductId },
                    });
                }

                const inventoryItem = await tx.inventoryItem.findFirst({
                    where: {
                        productId: resolvedProductId,
                        variantId: it.variantId ?? null,
                        locationId,
                        lotNumber,
                    },
                });

                const beforeTotal = await getAvailableQtyTx(tx, resolvedProductId, it.variantId ?? null);
                if (inventoryItem) {
                    const prevAvailable = calculateAvailableQty(inventoryItem.quantity, inventoryItem.reservedQuantity);
                    const updated = await tx.inventoryItem.update({
                        where: { id: inventoryItem.id },
                        data: { quantity: { increment: receivingNow }, unitCost: itemUnitCost, updatedAt: new Date() },
                    });
                    const nextAvailable = calculateAvailableQty(updated.quantity, inventoryItem.reservedQuantity);
                    const afterTotal = Math.max(beforeTotal - prevAvailable + nextAvailable, 0);
                    await maybeTriggerStockStatusSyncByTotals(resolvedProductId, it.variantId ?? null, beforeTotal, afterTotal);
                } else {
                    const created = await tx.inventoryItem.create({
                        data: {
                            productId: resolvedProductId,
                            variantId: it.variantId ?? null,
                            locationId,
                            quantity: receivingNow,
                            unitCost: itemUnitCost,
                            lotNumber,
                            receivedDate: new Date(),
                            updatedAt: new Date(),
                        },
                    });
                    const nextAvailable = calculateAvailableQty(created.quantity, created.reservedQuantity);
                    const afterTotal = Math.max(beforeTotal + nextAvailable, 0);
                    await maybeTriggerStockStatusSyncByTotals(resolvedProductId, it.variantId ?? null, beforeTotal, afterTotal);
                }
            }


            // Post to Ledger: Dr Inventory, Cr WIP (Asset Transfer) - Based on current batch value
            if (batchGrandValue > 0) {
                await ensureDefaultAccounts();
                const accounts = await tx.account.findMany({ select: { id: true, name: true } });
                const accountIndex = new Map(accounts.map((acc) => [acc.name.toLowerCase(), acc.id]));
                const wipId = accountIndex.get(ACCOUNT_LABELS.wip.toLowerCase());
                const inventoryAccountId = accountIndex.get(ACCOUNT_LABELS.inventory.toLowerCase());

                if (wipId && inventoryAccountId) {
                    const ledgerDate = new Date();
                    const postingGroup = `purchaseReceiving:${purchaseOrderId}:${Date.now()}`; // Unique per batch

                    const entryNumber = await resolveLedgerEntryNumber(tx, { date: ledgerDate, postingGroup });
                    const description = `Finished Goods Partial Recv PO #${purchaseOrderId}`;

                    await tx.ledgerEntry.createMany({
                        data: [
                            { date: ledgerDate, entryNumber, description, sourceTransactionId: purchaseOrderId, accountId: inventoryAccountId, debit: batchGrandValue, credit: 0, postingGroup },
                            { date: ledgerDate, entryNumber, description, sourceTransactionId: purchaseOrderId, accountId: wipId, debit: 0, credit: batchGrandValue, postingGroup }
                        ]
                    });
                }
            }

            // Determine PO status
            const allReceived = refreshedItems.every(it => (it.receivedQty ?? 0) >= (it.finalQty ?? it.quantity));
            const nextStatus: PurchaseOrderStatus = allReceived ? 'Received' : 'PartialReceived';
            const totalPoReceived = refreshedItems.reduce((sum, it) => sum + (it.receivedQty ?? 0), 0);

            await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: {
                    status: nextStatus,
                    currentStep: allReceived ? 'COMPLETED' : undefined,
                    finalReceivedQty: totalPoReceived,
                    PurchaseOrderLog: {
                        create: {
                            status: nextStatus,
                            description: `Received batch of ${batchTotalReceived} pcs. (Total: ${totalPoReceived})`,
                            user: actor,
                        }
                    }
                }
            });

            await recomputePaymentStatusTx(tx, purchaseOrderId);

            return tx.purchaseOrder.findUnique({
                where: { id: purchaseOrderId },
                include: {
                    Supplier: true,
                    PurchaseOrderItem: { include: { product: true, ProductVariant: true } },
                    PurchaseOrderLog: { orderBy: { timestamp: 'desc' as any } },
                    PurchasePayment: { include: { Vendor: true, ProductionStep: true } },
                    ProductionStep: { include: { Vendor: true }, orderBy: { stepType: 'asc' as any } },
                },
            });
        });

        await revalidateTags(['purchases', 'inventory']);
        return { success: true, purchaseOrder: result };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:finalizeThreePieceReceiving]', error);
        return { success: false, message: error.message || 'Failed to receive stock.' };
    }
}


export const purchaseOrderWithRelations = {
    include: {
        Supplier: true,
        PurchaseOrderItem: {
            include: {
                product: true,
                ProductVariant: true,
                FabricLotUsage: {
                    include: {
                        InventoryItem: {
                            include: { Product: true, ProductVariant: true, StockLocation: true },
                        },
                    },
                },
            },
        },
        PurchaseOrderLog: { orderBy: { timestamp: 'desc' as any } },
        PurchasePayment: { include: { Vendor: true, ProductionStep: true } },
        ProductionStep: { include: { Vendor: true }, orderBy: { stepType: 'asc' as any } },
    }
};

export type DbPurchaseOrder = Prisma.PurchaseOrderGetPayload<typeof purchaseOrderWithRelations>;

export function mapDbPoToAppPo(po: DbPurchaseOrder) {
    const payments = po.PurchasePayment || [];
    const generalPayments = payments.filter(p => p.paymentFor === 'General');
    const generalCashTotal = generalPayments.reduce((sum, p) => sum + (p.cash || 0), 0);
    const generalCheckTotal = generalPayments.reduce((sum, p) => sum + (p.check || 0), 0);
    const generalLatestCheckDate = generalPayments.reduce<Date | undefined>((latest, p) => {
        if (!p.checkDate) return latest;
        if (!latest || p.checkDate > latest) return p.checkDate;
        return latest;
    }, undefined);
    const generalCheckStatus = generalPayments.reduce<CheckStatus | undefined>(
        (status, p) => p.checkStatus || status,
        undefined
    );
    const generalPhysicalInvoiceUrl = generalPayments.reduce<string | undefined>(
        (url, p) => p.physicalInvoiceUrl || url,
        undefined
    );
    const generalPaidFromAccountId = generalPayments.length === 1 ? generalPayments[0].paidFromAccountId : undefined;
    const generalPaymentMethod = generalPayments.length === 1 ? generalPayments[0].paymentMethod : undefined;
    const generalPayment = generalPayments.length > 0 ? {
        cash: generalCashTotal,
        check: generalCheckTotal,
        checkNo: generalPayments.length === 1 ? (generalPayments[0] as any).checkNo || undefined : undefined,
        checkDate: generalLatestCheckDate ? generalLatestCheckDate.toISOString().slice(0, 10) : '',
        checkStatus: generalCheckStatus,
        physicalInvoiceUrl: generalPhysicalInvoiceUrl,
        paidFromAccountId: generalPaidFromAccountId ?? undefined,
        paymentMethod: generalPaymentMethod ?? undefined,
    } : undefined;
    const productionPaymentMap: any = {};

    // Only count passed checks
    const generalPassedCheck = generalPayments.reduce((sum, p) => sum + ((p.check && p.checkStatus === 'Passed') ? p.check : 0), 0);
    const generalPaidAmount = generalCashTotal + generalPassedCheck;

    payments.forEach((p) => {
        const inferred = STEP_TYPES.includes(p.paymentFor as ProductionStepType) ? (p.paymentFor as ProductionStepType) : undefined;
        const stepType: ProductionStepType | undefined = (p.ProductionStep as any)?.stepType ?? inferred;
        if (stepType) {
            productionPaymentMap[stepType] = {
                cash: p.cash,
                check: p.check,
                checkNo: (p as any).checkNo || undefined,
                checkDate: p.checkDate ? p.checkDate.toISOString().slice(0, 10) : '',
                checkStatus: p.checkStatus || undefined,
                physicalInvoiceUrl: p.physicalInvoiceUrl || undefined,
                productionStepId: p.productionStepId || undefined,
            };
        }
    });

    const productionSteps = (po.ProductionStep || []).map(step => ({
        id: step.id,
        poId: step.poId,
        stepType: step.stepType,
        vendorId: step.vendorId,
        fabricInventoryId: (step as any).fabricInventoryId ?? null,
        vendor: step.Vendor ? { ...step.Vendor, type: step.Vendor.type as any } : undefined,
        costAmount: step.costAmount,
        paidAmount: step.paidAmount,
        inputQty: step.inputQty,
        outputQty: step.outputQty,
        damagedQty: step.damagedQty,
        wastageQty: step.wastageQty,
        pindiOfFab: (step as any).pindiOfFab ?? undefined,
        invoiceUrl: step.invoiceUrl || undefined,
        generatedInvoiceNumber: step.generatedInvoiceNumber || undefined,
        isApproved: step.isApproved,
        cuttingType: (step as any).cuttingType || undefined,
        assignedStaffId: (step as any).assignedStaffId || undefined,
        note: (step as any).note || undefined,
    }));
    const stepTypeById = new Map(productionSteps.map((step) => [step.id, step.stepType]));
    const productionPaidAmount = payments.reduce((sum, p) => {
        const inferred = STEP_TYPES.includes(p.paymentFor as ProductionStepType)
            ? (p.paymentFor as ProductionStepType)
            : undefined;
        const stepType = p.productionStepId ? stepTypeById.get(p.productionStepId) : inferred;
        if (!stepType) return sum;
        const checkAmt = (p.check || 0) > 0 && p.checkStatus === 'Passed' ? p.check : 0;
        return sum + (p.cash || 0) + (checkAmt || 0);
    }, 0);
    const fabricPaidAmount = payments.reduce((sum, p) => {
        const inferred = STEP_TYPES.includes(p.paymentFor as ProductionStepType)
            ? (p.paymentFor as ProductionStepType)
            : undefined;
        const stepType = p.productionStepId ? stepTypeById.get(p.productionStepId) : inferred;
        if (stepType === 'FABRIC') {
            const checkAmt = (p.check || 0) > 0 && p.checkStatus === 'Passed' ? p.check : 0;
            return sum + (p.cash || 0) + (checkAmt || 0);
        }
        return sum;
    }, 0);
    const hasInternalFabric = (po.PurchaseOrderItem || []).some((item) => (item as any).FabricLotUsage?.length);
    const fabricStep = productionSteps.find((step) => step.stepType === 'FABRIC');
    const internalFabricPaid = hasInternalFabric && fabricStep
        ? Math.max(0, (fabricStep.costAmount || 0) - fabricPaidAmount)
        : 0;

    const typeMap: any = {
        'general': 'general',
        'three_piece': 'three-piece'
    };
    const statusMap: Record<string, any> = {
        FabricOrdered: 'Fabric Ordered',
        Cancelled: 'Cancelled',
        Draft: 'Draft',
        Printing: 'Printing',
        Cutting: 'Cutting',
        Received: 'Received',
        PartialReceived: 'Partial Received',
    };

    const lineItems = (po.PurchaseOrderItem || []).map(item => ({
        productName: item.ProductVariant?.name ? `${item.product?.name || 'Product'} - ${item.ProductVariant.name}` : (item.product?.name || 'Product'),
        sku: (item.ProductVariant as any)?.sku || (item.product as any)?.sku || null,
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal: item.unitCost * item.quantity,
    }));

    const purchaseItems = (po.PurchaseOrderItem || []).map((item) => {
        const jamaYards = Number((item as any).jamaYards) || 0;
        const jamaRate = Number((item as any).jamaRate) || 0;
        const ornaYards = Number((item as any).ornaYards) || 0;
        const ornaRate = Number((item as any).ornaRate) || 0;
        const selowarYards = Number((item as any).selowarYards) || 0;
        const selowarRate = Number((item as any).selowarRate) || 0;
        const fabricCost = jamaYards * jamaRate + ornaYards * ornaRate + selowarYards * selowarRate;
        const printingCost = Number((item as any).printingCost) || 0;
        const cuttingCost = Number((item as any).cuttingCost) || 0;
        const totalCost = fabricCost + printingCost + cuttingCost;
        const fabricLotUsages = (item as any).FabricLotUsage
            ? (item as any).FabricLotUsage.map((usage: any) => ({
                id: usage.id,
                poId: usage.poId,
                itemId: usage.itemId,
                part: usage.part,
                inventoryItemId: usage.inventoryItemId,
                yards: usage.yards,
                unitCost: usage.unitCost || 0,
                lotNumber: usage.InventoryItem?.lotNumber,
                locationName: usage.InventoryItem?.StockLocation?.name,
                productName: usage.InventoryItem?.ProductVariant?.name || usage.InventoryItem?.Product?.name,
                sku: usage.InventoryItem?.ProductVariant?.sku || usage.InventoryItem?.Product?.sku,
            }))
            : [];

        return {
            id: item.id,
            productId: item.productId,
            productName: item.product?.name || 'Product',
            variantId: item.variantId ?? null,
            variantName: item.ProductVariant?.name ?? null,
            sku: (item.ProductVariant as any)?.sku || (item.product as any)?.sku || null,
            quantity: item.quantity,
            finalQty: (item as any).finalQty ?? null,
            unitCost: item.unitCost || 0,
            jamaYards,
            jamaRate,
            ornaYards,
            ornaRate,
            selowarYards,
            selowarRate,
            fabricCost,
            printingCost,
            cuttingCost,
            totalCost,
            fabricLotUsages,
        };
    });

    const aggregatePaid = productionPaidAmount + generalPaidAmount + internalFabricPaid;
    const aggregateCostRaw = productionSteps.reduce((sum, step) => sum + (step.costAmount || 0), 0);
    const aggregateCost = aggregateCostRaw > 0 ? aggregateCostRaw : po.total;
    const paymentStatus = aggregateCost > 0 ? (aggregatePaid >= aggregateCost ? 'Paid' : aggregatePaid > 0 ? 'Partial' : 'Unpaid') : po.paymentStatus;

    return {
        id: po.id,
        supplier: po.Supplier?.name || 'Unknown Supplier',
        date: po.date.toISOString(),
        status: statusMap[po.status] || po.status,
        paymentStatus,
        total: po.total,
        items: po.items,
        finalReceivedQty: po.finalReceivedQty ?? undefined,
        type: typeMap[po.type],
        currentStep: po.currentStep as any,
        productionSteps,
        productionPayments: productionPaymentMap,
        offlineInvoiceUrl: po.offlineInvoiceUrl || undefined,
        pindiOfFab: (po.ProductionStep?.find(s => s.stepType === 'FABRIC') as any)?.pindiOfFab ?? undefined,
        damages: po.ProductionStep?.reduce((acc, step) => acc + (step.damagedQty || 0), 0) || 0,
        wastage: po.ProductionStep?.reduce((acc, step) => acc + (step.wastageQty || 0), 0) || 0,
        logs: (po.PurchaseOrderLog || []).map(l => ({
            ...l,
            status: statusMap[l.status] || l.status,
            timestamp: l.timestamp.toISOString()
        })),
        lineItems,
        purchaseItems,
        payments: (po.PurchasePayment || []).map(p => ({
            id: p.id,
            cash: p.cash ?? 0,
            check: p.check ?? 0,
            checkNo: (p as any).checkNo || undefined,
            checkDate: p.checkDate ? p.checkDate.toISOString().slice(0, 10) : '',
            checkStatus: p.checkStatus || undefined,
            paidFromAccountId: p.paidFromAccountId,
            paymentMethod: p.paymentMethod,
            productionStepId: p.productionStepId || undefined,
            physicalInvoiceUrl: p.physicalInvoiceUrl || undefined,
            date: (p as any).createdAt ? (p as any).createdAt.toISOString() : undefined
        })),
        payment: generalPayment ? {
            cash: generalPayment.cash,
            check: generalPayment.check,
            checkNo: generalPayment.checkNo || undefined,
            checkDate: generalPayment.checkDate || '',
            checkStatus: generalPayment.checkStatus || undefined,
            physicalInvoiceUrl: generalPayment.physicalInvoiceUrl || undefined
        } : undefined,
    };
}

export async function getPurchases({
    search,
    pageSize = 20,
    cursor,
    type,
    status,
    paymentStatus,
    supplierId,
    vendorId,
    from,
    to
}: {
    search?: string;
    pageSize?: number;
    cursor?: string;
    type?: PrismaPurchaseType;
    status?: string;
    paymentStatus?: PaymentStatus;
    supplierId?: string;
    vendorId?: string;
    from?: string;
    to?: string;
} = {}) {
    try {
        const where: any = {};
        if (from || to) {
            where.date = {};
            if (from) where.date.gte = new Date(from);
            if (to) where.date.lte = new Date(to);
        }
        if (search) {
            where.OR = [
                { id: { contains: search, mode: 'insensitive' } },
                { Supplier: { name: { contains: search, mode: 'insensitive' } } },
            ];
        }
        if (type) where.type = type;
        if (status) where.status = status;
        if (paymentStatus) where.paymentStatus = paymentStatus;
        if (supplierId) where.supplierId = supplierId;
        if (vendorId) {
            where.ProductionStep = {
                some: { vendorId }
            };
        }

        const items = await prisma.purchaseOrder.findMany({
            where,
            take: pageSize + 1,
            cursor: cursor ? { id: cursor } : undefined,
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
            ...purchaseOrderWithRelations
        }) as unknown as DbPurchaseOrder[];

        let nextCursor: string | null = null;
        if (items.length > pageSize) {
            const nextItem = items.pop();
            nextCursor = nextItem!.id;
        }

        return {
            items: items.map(mapDbPoToAppPo),
            nextCursor
        };
    } catch (error) {
        console.error('[SERVER_CORE_ERROR:getPurchases]', error);
        throw error;
    }
}

export async function getPurchaseStats(dateRange?: { from: string; to: string }) {
    try {
        const where: any = {};
        if (dateRange?.from || dateRange?.to) {
            where.date = {};
            if (dateRange.from) where.date.gte = new Date(dateRange.from);
            if (dateRange.to) where.date.lte = new Date(dateRange.to);
        }

        const stats = {
            totalCount: 0,
            totalValue: 0,
            totalRunningQty: 0,
            totalRunningValue: 0,
            inFabricQty: 0,
            inFabricValue: 0,
            inPrintingQty: 0,
            inPrintingValue: 0,
            inCuttingQty: 0,
            inCuttingValue: 0
        };

        const grouped = await prisma.purchaseOrder.groupBy({
            by: ['status'],
            where,
            _count: { _all: true },
            _sum: { total: true, items: true }
        });

        grouped.forEach((g) => {
            const count = g._count._all;
            const val = g._sum.total || 0;
            const qty = g._sum.items || 0;

            stats.totalCount += count;
            stats.totalValue += val;

            if (g.status !== 'Received' && g.status !== 'Cancelled') {
                stats.totalRunningQty += qty;
                stats.totalRunningValue += val;
            }

            if (g.status === 'FabricOrdered') {
                stats.inFabricQty += qty;
                stats.inFabricValue += val;
            } else if (g.status === 'Printing') {
                stats.inPrintingQty += qty;
                stats.inPrintingValue += val;
            } else if (g.status === 'Cutting') {
                stats.inCuttingQty += qty;
                stats.inCuttingValue += val;
            }
        });

        return stats;
    } catch (error) {
        console.error('[SERVER_CORE_ERROR:getPurchaseStats]', error);
        throw error;
    }
}


export type AddPurchasePaymentPayload = {
    poId: string;
    productionStepId?: string; // Explicit step ID
    payment: {
        paidFromAccountId?: string | null;
        businessId?: string | null;
        businessName?: string | null;
        businessLogo?: string | null;
        amount: number;
        method: string;
        checkDate?: string | null;
        checkNo?: string | null;
        physicalInvoiceUrl?: string; // Added for offline invoice
        note?: string;
    };
    user?: string;
};

export async function addPurchasePaymentCore(payload: AddPurchasePaymentPayload) {
    const { poId, productionStepId: explicitStepId, payment } = payload;
    const actor = payload.user || await getActorName('Admin');

    if (!poId) return { success: false, message: 'Purchase Order ID is required.' };
    await verifyPoNotPreCutoff(poId);
    if (payment.amount <= 0) return { success: false, message: 'Amount must be greater than zero.' };
    if (!payment.paidFromAccountId) return { success: false, message: 'Payment Account is required.' };
    if (payment.method === 'Check' && (!payment.checkNo || !payment.checkDate)) {
        return { success: false, message: 'Check Number and Date are required for checks.' };
    }

    if (payment.paidFromAccountId) {
        const account = await prisma.account.findUnique({ where: { id: payment.paidFromAccountId } });
        if (account && account.name.toLowerCase().includes('cash')) {
            const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
            try {
                await assertCashDrawerAccount(payment.paidFromAccountId);
            } catch (err: any) {
                return { success: false, message: err.message === 'CASH_DRAWER_INACTIVE' ? 'Selected Cash Drawer is inactive.' : 'Cash payments must specify a valid Cash Drawer.' };
            }
        }
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { ProductionStep: true } });
            if (!po) throw new Error('Purchase order not found.');

            await ensureDefaultAccounts();
            const accounts = await tx.account.findMany({ select: { id: true, name: true } });
            const accountMap = new Map(accounts.map((a) => [a.name, a.id]));
            const apId = accountMap.get(ACCOUNT_LABELS.accountsPayable) || accountMap.get('Accounts Payable');
            if (!apId) throw new Error('Accounts Payable account missing.');

            // Determine production step if applicable (Three Piece)
            // Determine production step if applicable
            let productionStepId: string | undefined = explicitStepId;
            if (!productionStepId && po.type === 'three_piece') {
                // Legacy fallback or default to FABRIC if undefined?
                // Better to rely on explicitStepId for specific steps.
                // But for backward compatibility if any general pay call existed:
                const fabricStep = po.ProductionStep.find(s => s.stepType === 'FABRIC');
                productionStepId = fabricStep?.id;
            }

            // Create Payment Record
            const created = await tx.purchasePayment.create({
                data: {
                    poId,
                    productionStepId,
                    paymentFor: productionStepId ?
                        po.ProductionStep.find(s => s.id === productionStepId)?.stepType as any || 'FABRIC'
                        : (po.type === 'three_piece' ? 'FABRIC' : 'General'),
                    cash: payment.method === 'Cash' || payment.method === 'Direct' ? payment.amount : 0,
                    check: payment.method === 'Check' ? payment.amount : 0,
                    checkDate: payment.checkDate ? new Date(payment.checkDate) : undefined,
                    checkStatus: payment.method === 'Check' ? 'Pending' : undefined,
                    // @ts-ignore
                    checkNo: payment.checkNo || undefined,
                    paidFromAccountId: payment.paidFromAccountId || null,
                    paymentMethod: payment.method,
                    physicalInvoiceUrl: payment.physicalInvoiceUrl,
                }
            });

            // Ledger Entries
            const today = new Date();
            const postingGroup = `purchasePayment:${created.id}`; // ADDED
            const entryNumber = await resolveLedgerEntryNumber(tx, { date: today, postingGroup }); // UPDATED

            // Calculate ledger amount:
            // If Cash/Direct -> Full Amount
            // If Check -> 0 (because it starts as Pending, and we only book Passed checks)
            const ledgerAmount = (payment.method === 'Check') ? 0 : payment.amount;

            if (ledgerAmount > 0) {
                // Dr Accounts Payable, Cr Cash/Bank
                await tx.ledgerEntry.createMany({
                    data: [
                        {
                            date: today,
                            entryNumber,
                            description: `PO Due Payment #${poId} (${payment.method})`,
                            sourceTransactionId: created.id, // UPDATED
                            accountId: apId,
                            debit: ledgerAmount,
                            credit: 0,
                            postingGroup // ADDED
                        },
                        {
                            date: today,
                            entryNumber,
                            description: `PO Due Payment #${poId} (${payment.method})`,
                            sourceTransactionId: created.id, // UPDATED
                            accountId: payment.paidFromAccountId!,
                            debit: 0,
                            credit: ledgerAmount,
                            postingGroup // ADDED
                        }
                    ]
                });
            }

            await syncStepPaidFromPaymentsTx(tx, poId);
            await recomputePaymentStatusTx(tx, poId);

            // Re-fetch PO
            return tx.purchaseOrder.findUnique({
                where: { id: poId },
                include: {
                    Supplier: true,
                    PurchaseOrderItem: { include: { product: true, ProductVariant: true } },
                    PurchaseOrderLog: { orderBy: { timestamp: 'desc' as any } },
                    PurchasePayment: { include: { Vendor: true, ProductionStep: true } },
                    ProductionStep: { include: { Vendor: true }, orderBy: { stepType: 'asc' as any } },
                },
            });
        });

        await revalidateTags(['purchases']);
        if (result) return { success: true, purchaseOrder: mapDbPoToAppPo(result as any) };
        return { success: false, message: 'Failed to return updated status.' };

    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:addPurchasePayment]', error);
        return { success: false, message: resolvePurchaseErrorMessage(error, 'Failed to add payment.') };
    }
}

export async function deletePurchasePaymentCore(paymentId: string, poId: string) {
    try {
        await verifyPoNotPreCutoff(poId);
        await prisma.$transaction(async (tx) => {
            // Reverse ledger entries for this payment
            await tx.ledgerEntry.deleteMany({
                where: {
                    OR: [
                        { postingGroup: `purchasePayment:${paymentId}` },
                        { sourceTransactionId: paymentId }
                    ]
                }
            });

            await tx.purchasePayment.delete({ where: { id: paymentId } });
            await syncStepPaidFromPaymentsTx(tx, poId);
            await recomputePaymentStatusTx(tx, poId);
        });

        await revalidateTags(['purchases']);
        const updated = await getPurchaseOrderById(poId);
        return { success: true, purchaseOrder: updated };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:deletePurchasePayment]', error);
        return { success: false, message: 'Failed to delete payment.' };
    }
}

export async function updatePurchaseOrderOfflineInvoiceCore(poId: string, url: string, user?: string) {
    const actor = user || await getActorName('Admin');
    try {
        await verifyPoNotPreCutoff(poId);
        const updatedPo = await prisma.purchaseOrder.update({
            where: { id: poId },
            data: {
                offlineInvoiceUrl: url,
                PurchaseOrderLog: {
                    create: {
                        status: 'Draft', // Using existing status or default
                        description: `Offline invoice updated`,
                        user: actor,
                    },
                },
            },
        });

        await syncStepPaidFromPaymentsTx(prisma, poId);
        await recomputePaymentStatusTx(prisma, poId);

        await revalidateTags(['purchases']);
        const mappedPo = await getPurchaseOrderById(poId);
        return { success: true, purchaseOrder: mappedPo };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:updatePurchaseOrderOfflineInvoice]', error);
        return { success: false, message: error.message || 'Failed to update offline invoice.' };
    }
}

export async function updateProductionStepInvoiceCore(poId: string, stepId: string, url: string, user?: string) {
    const actor = user || await getActorName('Admin');
    try {
        await verifyPoNotPreCutoff(poId);
        await prisma.productionStep.update({
            where: { id: stepId },
            data: { invoiceUrl: url },
        });

        const updatedPo = await prisma.purchaseOrder.update({
            where: { id: poId },
            data: {
                PurchaseOrderLog: {
                    create: {
                        status: 'Draft',
                        description: `Step invoice updated`,
                        user: actor,
                    },
                },
            },
        });

        await revalidateTags(['purchases']);
        const mappedPo = await getPurchaseOrderById(poId);
        return { success: true, purchaseOrder: mappedPo };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:updateProductionStepInvoice]', error);
        return { success: false, message: error.message || 'Failed to update step invoice.' };
    }
}

export async function getSupplierDueBalance(supplierId: string) {
    const pos = await prisma.purchaseOrder.findMany({
        where: { supplierId, paymentStatus: { in: ['Unpaid', 'Partial'] } },
        include: { PurchasePayment: true }
    });

    return pos.reduce((sum, po) => {
        const paid = po.PurchasePayment.reduce((s, p) => {
            const passedAmt = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
            return s + (p.cash || 0) + passedAmt;
        }, 0);
        return sum + Math.max(0, po.total - paid);
    }, 0);
}

export async function getVendorDueBalance(vendorId: string) {
    const steps = await prisma.productionStep.findMany({
        where: { vendorId, paymentStatus: { in: ['Unpaid', 'Partial'] } } as any,
        include: {
            PurchasePayment: true,
            PurchaseOrder: {
                include: {
                    PurchaseOrderItem: true
                }
            }
        }
    });

    return (steps as any[]).reduce((sum, step) => {
        let stepTotal = 0;
        const items = step.PurchaseOrder.PurchaseOrderItem;
        if (step.stepType === 'PRINTING') {
            stepTotal = items.reduce((s: number, item: any) => s + (item.quantity * (item.printingCost || 0)), 0);
        } else if (step.stepType === 'CUTTING') {
            stepTotal = items.reduce((s: number, item: any) => {
                const billable = Math.max(0, (item.quantity || 0) - (item.printingDamagedQty || 0) - (item.cuttingDamagedQty || 0));
                return s + (billable * (item.cuttingCost || 0));
            }, 0);
        }
        const paid = ((step.PurchasePayment || []) as any[]).reduce((s, p) => {
            const passedAmt = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
            return s + (p.cash || 0) + passedAmt;
        }, 0);
        return sum + Math.max(0, stepTotal - paid);
    }, 0);
}

/**
 * applyPartnerPaymentCore
 * 
 * Handles centralized FIFO payments for Suppliers or Vendors.
 * Allocates payment across unpaid POs (for suppliers) or Steps (for vendors).
 * Surplus goes to partner's creditBalance.
 */
export async function applyPartnerPaymentCore(payload: {
    partnerId: string;
    partnerType: 'SUPPLIER' | 'VENDOR';
    amount: number;
    accountId: string;
    method: string;
    checkDate?: string;
    checkNo?: string;
    description?: string;
    user?: string;
}) {
    const { partnerId, partnerType, amount, accountId, method, checkDate, checkNo, description, user } = payload;
    const isCheck = method === 'Check';
    const isCashLike = ['Cash', 'Direct', 'bKash', 'Nagad', 'Rocket'].includes(method);

    if (accountId) {
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        if (account && account.name.toLowerCase().includes('cash')) {
            const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
            try {
                await assertCashDrawerAccount(accountId);
            } catch (err: any) {
                throw new Error(err.message === 'CASH_DRAWER_INACTIVE' ? 'Selected Cash Drawer is inactive.' : 'Cash payments must specify a valid Cash Drawer.');
            }
        }
    }

    const txResult = await prisma.$transaction(async (tx) => {

        // 1. Resolve Accounts Upfront
        const accounts = await tx.account.findMany({
            where: { name: { in: ['Accounts Payable', 'Supplier Advance'] } },
            select: { id: true, name: true }
        });
        const apAccount = accounts.find(a => a.name === 'Accounts Payable');
        const advanceAccount = accounts.find(a => a.name === 'Supplier Advance');

        if (!apAccount || !advanceAccount) throw new Error("Missing required accounts: Accounts Payable or Supplier Advance");

        let remaining = amount;
        let totalAllocated = 0;

        const cutoff = await tx.cutoffRevision.findFirst({ where: { status: 'APPLIED' }, orderBy: { appliedAt: 'desc' } });
        const cutoffDate = cutoff?.cutoffDate;

        if (cutoffDate) {
            const { getOpeningBalanceForEntity } = await import('@/server/modules/cutoff');
            const { buildCheckPassingItemFromCutoffSettlement, upsertCheckPassingItem } = await import('@/server/modules/check-passing-items');
            const entityTypeLower = partnerType.toLowerCase();
            const ob = await getOpeningBalanceForEntity(entityTypeLower, partnerId);
            if (ob > 0) {
                const settlements = await tx.cutoffSettlement.findMany({
                    where: { revisionId: cutoff.id, entityType: entityTypeLower, entityId: partnerId }
                });
                const paidOb = settlements.reduce((sum: number, s: any) => {
                    const passedCheck = s.checkStatus === 'Passed' ? s.check : 0;
                    return sum + s.cash + passedCheck;
                }, 0);
                const unpaidOb = Math.max(0, ob - paidOb);

                if (unpaidOb > 0 && remaining > 0) {
                    const allocateToOb = Number(Math.min(remaining, unpaidOb).toFixed(2));
                    
                    const settlement = await tx.cutoffSettlement.create({
                        data: {
                            revisionId: cutoff.id,
                            entityType: entityTypeLower,
                            entityId: partnerId,
                            cash: isCashLike ? allocateToOb : 0,
                            check: isCheck ? allocateToOb : 0,
                            checkDate: checkDate ? new Date(checkDate) : null,
                            checkStatus: isCheck ? 'Pending' : undefined,
                            checkNo,
                            paymentMethod: method,
                            paidFromAccountId: accountId
                        }
                    });

                    // Build check passing item if check
                    if (isCheck && allocateToOb > 0) {
                        const checkItem = await buildCheckPassingItemFromCutoffSettlement(tx as any, settlement.id);
                        if (checkItem) await upsertCheckPassingItem(tx as any, checkItem);
                    }

                    const postingGroup = `obSettlement:${settlement.id}`;
                    const entryNumber = await resolveLedgerEntryNumber(tx as any, { date: new Date(), postingGroup });
                    const ledgerDescription = description || `Opening Balance Settlement for ${partnerType}`;

                    const ledgerEntries: any[] = [];
                    // 1. Cash/Direct Part
                    if (isCashLike && allocateToOb > 0) {
                        ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription, postingGroup, accountId: apAccount.id, debit: allocateToOb, credit: 0, sourceTransactionId: settlement.id });
                        ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription, postingGroup, accountId: accountId, debit: 0, credit: allocateToOb, sourceTransactionId: settlement.id });
                    }
                    // 2. Check Part (Pending)
                    if (isCheck && allocateToOb > 0) {
                        ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription, postingGroup, accountId: advanceAccount.id, debit: allocateToOb, credit: 0, sourceTransactionId: settlement.id });
                        ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription, postingGroup, accountId: accountId, debit: 0, credit: allocateToOb, sourceTransactionId: settlement.id });
                    }

                    if (ledgerEntries.length > 0) {
                        await tx.ledgerEntry.createMany({ data: ledgerEntries });
                    }

                    remaining -= allocateToOb;
                    totalAllocated += allocateToOb;
                }
            }
        }

        if (partnerType === 'SUPPLIER') {
            const poWhere: any = { supplierId: partnerId, paymentStatus: { in: ['Unpaid', 'Partial'] } };
            if (cutoffDate) poWhere.date = { gt: cutoffDate };

            const pos = await tx.purchaseOrder.findMany({
                where: poWhere,
                orderBy: { date: 'asc' }, // FIFO by PO Date
                include: { PurchasePayment: true }
            });

            for (const po of pos) {
                if (remaining <= 0) break;

                // Filter for only 'Passed' checks when calculating 'paid'
                const paid = po.PurchasePayment.reduce((s, p) => s + (p.cash || 0) + ((p.check && p.checkStatus === 'Passed') ? p.check : 0), 0);
                const due = Math.max(0, po.total - paid);

                if (due <= 0) continue;

                const allocation = Number(Math.min(remaining, due).toFixed(2));

                const payment = await tx.purchasePayment.create({
                    data: {
                        poId: po.id,
                        cash: isCashLike ? allocation : 0,
                        check: isCheck ? allocation : 0,
                        checkStatus: isCheck ? 'Pending' : undefined,
                        checkDate: checkDate ? new Date(checkDate) : null,
                        checkNo,
                        paymentMethod: method,
                        paidFromAccountId: accountId,
                        paymentFor: 'Purchase Balance (FIFO)',
                    }
                });

                if (isCheck && allocation > 0) {
                    const checkItem = await buildCheckPassingItemFromPurchasePayment(tx as any, payment.id);
                    if (checkItem) await upsertCheckPassingItem(tx as any, checkItem);
                }

                const effectiveAllocation = isCashLike ? allocation : 0;
                const newTotalPaid = paid + effectiveAllocation;
                const newStatus: PaymentStatus = newTotalPaid >= (po.total - 0.01) ? 'Paid' : 'Partial';

                if (isCashLike) {
                    await tx.purchaseOrder.update({
                        where: { id: po.id },
                        data: { paymentStatus: newStatus }
                    });
                }

                // Payment-linked Ledger Entry (Immediate)
                const postingGroup = `purchasePayment:${payment.id}`;
                const entryNumber = await resolveLedgerEntryNumber(tx, { date: new Date(), postingGroup });
                const ledgerDescription = description || `Payment for PO #${po.id}`;

                const ledgerEntries: any[] = [];
                // 1. Cash/Direct Part
                if (isCashLike && allocation > 0) {
                    // Dr AP, Cr Source
                    ledgerEntries.push({
                        date: new Date(), entryNumber, description: ledgerDescription, sourceTransactionId: payment.id, postingGroup,
                        accountId: apAccount.id, debit: allocation, credit: 0
                    });
                    ledgerEntries.push({
                        date: new Date(), entryNumber, description: ledgerDescription, sourceTransactionId: payment.id, postingGroup,
                        accountId: accountId, debit: 0, credit: allocation
                    });
                }
                // 2. Check Part (Pending)
                if (isCheck && allocation > 0) {
                    // Dr Supplier Advance, Cr Source
                    ledgerEntries.push({
                        date: new Date(), entryNumber, description: ledgerDescription, sourceTransactionId: payment.id, postingGroup,
                        accountId: advanceAccount.id, debit: allocation, credit: 0
                    });
                    ledgerEntries.push({
                        date: new Date(), entryNumber, description: ledgerDescription, sourceTransactionId: payment.id, postingGroup,
                        accountId: accountId, debit: 0, credit: allocation
                    });
                }

                if (ledgerEntries.length > 0) {
                    await tx.ledgerEntry.createMany({ data: ledgerEntries });
                }

                remaining -= allocation;
                totalAllocated += allocation;
            }

            if (remaining > 0.01) {
                await tx.supplier.update({
                    where: { id: partnerId },
                    data: { creditBalance: { increment: remaining } }
                });
            }
        } else {
            // VENDOR FIFO
            const stepWhere: any = { vendorId: partnerId, paymentStatus: { in: ['Unpaid', 'Partial'] } };
            if (cutoffDate) {
                stepWhere.PurchaseOrder = { date: { gt: cutoffDate } };
            }

            const steps = await tx.productionStep.findMany({
                where: stepWhere,
                orderBy: { createdAt: 'asc' },
                include: {
                    PurchasePayment: true,
                    PurchaseOrder: {
                        include: {
                            PurchaseOrderItem: true
                        }
                    }
                }
            });

            for (const step of (steps as any[])) {
                if (remaining <= 0) break;

                const stepTotal = Number(step.costAmount || 0);

                const paid = (step.PurchasePayment || []).reduce((s: number, p: any) => {
                    const passedAmt = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
                    return s + (p.cash || 0) + passedAmt;
                }, 0);
                const due = Math.max(0, stepTotal - paid);

                if (due <= 0) continue;

                const allocation = Number(Math.min(remaining, due).toFixed(2));

                const payment = await tx.purchasePayment.create({
                    data: {
                        poId: step.poId,
                        productionStepId: step.id,
                        vendorId: partnerId,
                        cash: isCashLike ? allocation : 0,
                        check: isCheck ? allocation : 0,
                        checkStatus: isCheck ? 'Pending' : undefined,
                        checkDate: checkDate ? new Date(checkDate) : null,
                        checkNo,
                        paymentMethod: method,
                        paidFromAccountId: accountId,
                        paymentFor: `Production Step (${step.stepType})`,
                    }
                });

                if (isCheck && allocation > 0) {
                    const checkItem = await buildCheckPassingItemFromPurchasePayment(tx as any, payment.id);
                    if (checkItem) await upsertCheckPassingItem(tx as any, checkItem);
                }

                const effectiveAllocation = isCashLike ? allocation : 0;
                const newTotalPaid = paid + effectiveAllocation;
                const newStatus: PaymentStatus = newTotalPaid >= (stepTotal - 0.01) ? 'Paid' : 'Partial';

                if (isCashLike) {
                    await tx.productionStep.update({
                        where: { id: step.id },
                        data: { paymentStatus: newStatus } as any
                    });
                }

                // Payment-linked Ledger Entry (Immediate)
                const postingGroup = `purchasePayment:${payment.id}`;
                const entryNumber = await resolveLedgerEntryNumber(tx, { date: new Date(), postingGroup });
                const ledgerDescription = description || `Payment for Step (${step.stepType})`;

                const ledgerEntries: any[] = [];
                // 1. Cash/Direct Part
                if (isCashLike && allocation > 0) {
                    // Dr AP, Cr Source
                    ledgerEntries.push({
                        date: new Date(), entryNumber, description: ledgerDescription, sourceTransactionId: payment.id, postingGroup,
                        accountId: apAccount.id, debit: allocation, credit: 0
                    });
                    ledgerEntries.push({
                        date: new Date(), entryNumber, description: ledgerDescription, sourceTransactionId: payment.id, postingGroup,
                        accountId: accountId, debit: 0, credit: allocation
                    });
                }
                // 2. Check Part (Pending)
                if (isCheck && allocation > 0) {
                    // Dr Supplier Advance, Cr Source
                    ledgerEntries.push({
                        date: new Date(), entryNumber, description: ledgerDescription, sourceTransactionId: payment.id, postingGroup,
                        accountId: advanceAccount.id, debit: allocation, credit: 0
                    });
                    ledgerEntries.push({
                        date: new Date(), entryNumber, description: ledgerDescription, sourceTransactionId: payment.id, postingGroup,
                        accountId: accountId, debit: 0, credit: allocation
                    });
                }

                if (ledgerEntries.length > 0) {
                    await tx.ledgerEntry.createMany({ data: ledgerEntries });
                }

                remaining -= allocation;
                totalAllocated += allocation;
            }

            if (remaining > 0.01) {
                await tx.vendor.update({
                    where: { id: partnerId },
                    data: { creditBalance: { increment: remaining } }
                });
            }
        }

        // --- ACCOUNTING LEDGER (Advance Overflow Only) ---
        // Any remaining amount is a true advance (not linked to a specific PO payment)
        if (remaining > 0.01) {
            const advanceAccount = await tx.account.findFirst({ where: { name: 'Supplier Advance' } });
            if (advanceAccount) {
                const postingGroup = `partnerAdvance:${partnerType}:${partnerId}:${Date.now()}`;
                const entryNumber = await resolveLedgerEntryNumber(tx, { date: new Date(), postingGroup });
                await tx.ledgerEntry.createMany({
                    data: [
                        {
                            date: new Date(), entryNumber, description: description || `Advance Payment - ${partnerType}`,
                            sourceTransactionId: partnerId, postingGroup,
                            accountId: advanceAccount.id, debit: remaining, credit: 0
                        },
                        {
                            date: new Date(), entryNumber, description: description || `Advance Payment - ${partnerType}`,
                            sourceTransactionId: partnerId, postingGroup,
                            accountId: accountId, debit: 0, credit: remaining
                        }
                    ]
                });
            }
        }

        return { success: true, allocated: totalAllocated, advance: remaining };
    });

    // --- Fire Partner Payment SMS ---
    try {
        const { sendPartnerPaymentSms } = await import('./sms-notifications');
        let partnerName = '';
        let partnerPhone: string | null = null;
        let nextDue = 0;

        if (partnerType === 'SUPPLIER') {
            const supplier = await prisma.supplier.findUnique({ where: { id: partnerId } });
            if (supplier) {
                partnerName = supplier.name;
                partnerPhone = supplier.phone;
                nextDue = await getSupplierDueBalance(partnerId);
            }
        } else {
            const vendor = await prisma.vendor.findUnique({ where: { id: partnerId } });
            if (vendor) {
                partnerName = vendor.name;
                partnerPhone = vendor.phone;
                nextDue = await getVendorDueBalance(partnerId);
            }
        }
        
        if (partnerName) {
            await sendPartnerPaymentSms({
                partnerId,
                partnerName,
                partnerPhone,
                partnerType,
                paymentAmount: amount,
                nextDue
            });
        }
    } catch (e) {
        console.error('[SMS_TRIGGER_ERROR_PARTNER_PAYMENT]', e);
    }
    // --------------------------------

    return txResult;
}
