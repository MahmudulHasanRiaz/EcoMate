import { Prisma, PrismaClient, CheckPassingSource, CheckStatus } from '@prisma/client';
import prisma from '@/lib/prisma';

type TransactionClient = Omit<
    PrismaClient,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// Helper to sanitize undefined values or ensure types
function ensureString(val: string | null | undefined): string | null {
    return val || null;
}

export async function deleteCheckPassingItem(
    tx: TransactionClient | PrismaClient,
    source: CheckPassingSource,
    sourceId: string
) {
    try {
        await tx.checkPassingItem.delete({
            where: {
                source_sourceId: {
                    source,
                    sourceId,
                },
            },
        });
    } catch (error: any) {
        if (error.code !== 'P2025') { // Record to delete does not exist
            console.error('[CHECK_PASSING_DELETE_ERROR]', error);
            throw error;
        }
    }
}

export async function upsertCheckPassingItem(
    tx: TransactionClient | PrismaClient,
    data: {
        source: CheckPassingSource;
        sourceId: string;
        passingDate: Date;
        amount: number;
        status: CheckStatus;
        checkNo?: string | null;
        referenceId?: string | null;
        referenceLabel?: string | null;
        referenceUrl?: string | null;
        payee?: string | null;
        type?: string | null;
    }
) {
    const payload = {
        source: data.source,
        sourceId: data.sourceId,
        passingDate: data.passingDate,
        amount: data.amount,
        status: data.status,
        checkNo: ensureString(data.checkNo),
        referenceId: ensureString(data.referenceId),
        referenceLabel: ensureString(data.referenceLabel),
        referenceUrl: ensureString(data.referenceUrl),
        payee: ensureString(data.payee),
        type: ensureString(data.type),
        updatedAt: new Date(),
    };

    await tx.checkPassingItem.upsert({
        where: {
            source_sourceId: {
                source: data.source,
                sourceId: data.sourceId,
            },
        },
        update: payload,
        create: {
            ...payload,
            createdAt: new Date(),
        },
    });
}

// --- Builders ---

export async function buildCheckPassingItemFromPurchasePayment(
    tx: TransactionClient | PrismaClient,
    paymentId: string
) {
    const payment = await tx.purchasePayment.findUnique({
        where: { id: paymentId },
        include: {
            PurchaseOrder: { select: { Supplier: true } },
            Vendor: true,
            ProductionStep: { include: { Vendor: true } }
        }
    });

    if (!payment) return null;
    if (!payment.check || payment.check <= 0) return null;
    if (!payment.checkDate) return null;

    // Determine Payee
    let payee = 'Unknown';
    if (payment.Vendor) {
        payee = payment.Vendor.name;
    } else if (payment.ProductionStep?.Vendor) {
        payee = payment.ProductionStep.Vendor.name;
    } else if (payment.PurchaseOrder?.Supplier) {
        payee = payment.PurchaseOrder.Supplier.name;
    }

    // Determine Type
    let type = 'Purchase';
    if (payment.ProductionStep) {
        type = `${formatStepType(payment.ProductionStep.stepType)} Bill`;
    } else if (payment.paymentFor) {
        type = `${capitalize(payment.paymentFor)} Payment`;
    }

    // Determine URL
    // Matches logic in current API: purchase -> /dashboard/purchases/[id]
    const referenceUrl = `/dashboard/purchases/${payment.poId}`;

    // Determine Label (PO ID or similar)
    // Matches logic: "PO-xxxx"
    // We don't have the PO number separate from ID usually, but let's check
    // Usually we use PO ID or just "Purchase Order"
    const referenceLabel = 'Purchase Order';

    return {
        source: CheckPassingSource.Purchase,
        sourceId: payment.id,
        passingDate: payment.checkDate,
        amount: payment.check,
        status: payment.checkStatus || CheckStatus.Pending,
        checkNo: payment.checkNo,
        referenceId: payment.poId,
        referenceLabel,
        referenceUrl,
        payee,
        type,
    };
}

export async function buildCheckPassingItemFromExpense(
    tx: TransactionClient | PrismaClient,
    expenseId: string
) {
    const expense = await tx.expense.findUnique({
        where: { id: expenseId },
        include: {
            ExpenseCategory: true,
            StaffPayment: { include: { staff: true } }
        }
    });

    if (!expense) return null;
    if (!expense.check || expense.check <= 0) return null;
    if (!expense.checkDate) return null;

    let payee = 'General Expense';
    if (expense.StaffPayment?.staff) {
        payee = expense.StaffPayment.staff.name;
    }

    const type = expense.ExpenseCategory?.name || 'Expense';

    // Logic matches: /dashboard/expenses?highlight=[id] or similar. 
    // Current API uses just /dashboard/expenses usually.
    const referenceUrl = `/dashboard/expenses`;

    return {
        source: CheckPassingSource.Expense,
        sourceId: expense.id,
        passingDate: expense.checkDate,
        amount: expense.check,
        status: expense.checkStatus || CheckStatus.Pending,
        checkNo: expense.checkNo,
        referenceId: expense.id,
        referenceLabel: expense.notes || 'Expense', // Often notes used for label
        referenceUrl,
        payee,
        type,
    };
}

export async function buildCheckPassingItemFromStaffPayment(
    tx: TransactionClient | PrismaClient,
    paymentId: string
) {
    const payment = await tx.staffPayment.findUnique({
        where: { id: paymentId },
        include: { staff: true }
    });

    if (!payment) return null;
    // Note: staff payment model uses 'check' field too? 
    // Schema says: check Float @default(0), checkDate DateTime?
    if (!payment.check || payment.check <= 0) return null;
    if (!payment.checkDate) return null;

    const payee = payment.staff.name;
    const type = 'Salary/Payment';
    const referenceUrl = `/dashboard/staff/${payment.staffId}`;

    return {
        source: CheckPassingSource.Staff,
        sourceId: payment.id,
        passingDate: payment.checkDate,
        amount: payment.check,
        status: payment.checkStatus || CheckStatus.Pending,
        checkNo: payment.checkNo,
        referenceId: payment.staffId,
        referenceLabel: payment.notes || 'Staff Payment',
        referenceUrl,
        payee,
        type,
    };
}

export async function buildCheckPassingItemFromCutoffSettlement(
    tx: TransactionClient | PrismaClient,
    settlementId: string
) {
    const settlement = await tx.cutoffSettlement.findUnique({
        where: { id: settlementId }
    });

    if (!settlement) return null;
    if (!settlement.check || settlement.check <= 0) return null;
    if (!settlement.checkDate) return null;

    let payee = 'Unknown';
    if (settlement.entityType === 'supplier') {
        const s = await tx.supplier.findUnique({ where: { id: settlement.entityId } });
        if (s) payee = s.name;
    } else if (settlement.entityType === 'vendor') {
        const v = await tx.vendor.findUnique({ where: { id: settlement.entityId } });
        if (v) payee = v.name;
    }

    const type = 'Opening Balance';
    const referenceUrl = `/dashboard/partners/${settlement.entityId}`;

    return {
        source: CheckPassingSource.CutoffSettlement,
        sourceId: settlement.id,
        passingDate: settlement.checkDate,
        amount: settlement.check,
        status: settlement.checkStatus || CheckStatus.Pending,
        checkNo: settlement.checkNo,
        referenceId: settlement.entityId,
        referenceLabel: 'Opening Balance',
        referenceUrl,
        payee,
        type,
    };
}

// Utils
function capitalize(s: string) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatStepType(t: string) {
    return t.charAt(0) + t.slice(1).toLowerCase();
}
