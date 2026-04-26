import { Prisma, CheckStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { ACCOUNT_LABELS, resolveLedgerEntryNumber } from './accounting';

/**
 * Rebuilds staff payment ledger entries using cleared-funds logic.
 * Only cash portion + passed check portion create ledger entries.
 * Pending/Bounced/Cancelled checks don't credit cash/bank.
 */
export async function rebuildStaffPaymentLedger(
    tx: Prisma.TransactionClient,
    paymentId: string
): Promise<void> {
    const payment = await tx.staffPayment.findUnique({
        where: { id: paymentId },
        include: { staff: true },
    });

    if (!payment) {
        throw new Error('Staff payment not found');
    }

    const postingGroup = `staffPayment:${paymentId}`;

    // Always clear existing entries first
    await tx.ledgerEntry.deleteMany({ where: { postingGroup } });

    const amount = Number(payment.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        return; // No amount to record
    }

    // Cleared-funds calculation
    const checkAmount = Math.max(0, Math.min(Number(payment.check || 0), amount));
    const cashPortion = Math.max(0, amount - checkAmount);
    const passedCheckPortion =
        payment.checkStatus === 'Passed' ? checkAmount : 0;
    const ledgerAmount = cashPortion + passedCheckPortion;

    if (ledgerAmount <= 0) {
        return; // No cleared funds yet (all pending/bounced/cancelled)
    }

    // Get accounts
    const accounts = await tx.account.findMany({
        select: { id: true, name: true }
    });
    const accountIndex = new Map(
        accounts.map((acc) => [acc.name.toLowerCase(), acc.id])
    );

    const staffPayableId = accountIndex.get(
        ACCOUNT_LABELS.salariesPayable?.toLowerCase() || 'salaries payable'
    );
    const cashAccountId =
        payment.paidFromAccountId ||
        accountIndex.get(ACCOUNT_LABELS.cash?.toLowerCase() || 'cash');

    if (!staffPayableId || !cashAccountId) {
        console.warn('[STAFF_PAYMENT_LEDGER] Missing accounts', {
            paymentId,
            hasPayable: !!staffPayableId,
            hasCash: !!cashAccountId
        });
        return; // Cannot post without accounts
    }

    if (cashAccountId) {
        const account = await tx.account.findUnique({ where: { id: cashAccountId }, select: { name: true } });
        if (account && account.name.toLowerCase().includes('cash')) {
            const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
            try {
                await assertCashDrawerAccount(cashAccountId);
            } catch (err: any) {
                throw new Error(err.message === 'CASH_DRAWER_INACTIVE' ? 'Selected Cash Drawer is inactive.' : 'Cash payments must specify a valid Cash Drawer.');
            }
        }
    }

    const entryNumber = await resolveLedgerEntryNumber(tx, {
        date: payment.date,
        postingGroup,
    });

    const description = `Staff payment to ${payment.staff.name}`;

    await tx.ledgerEntry.createMany({
        data: [
            {
                date: payment.date,
                entryNumber,
                description,
                sourceTransactionId: payment.id,
                accountId: staffPayableId,
                debit: ledgerAmount,
                credit: 0,
                postingGroup,
            },
            {
                date: payment.date,
                entryNumber,
                description,
                sourceTransactionId: payment.id,
                accountId: cashAccountId,
                debit: 0,
                credit: ledgerAmount,
                postingGroup,
            },
        ],
        skipDuplicates: true,
    });
}

/**
 * Updates staff payment check status and reconciles ledger.
 * To be called from check-passing route.
 */
export async function updateStaffPaymentCheckStatus(
    paymentId: string,
    status: CheckStatus,
    tx?: Prisma.TransactionClient
): Promise<void> {
    const client = tx || prisma;

    const payment = await client.staffPayment.findUnique({
        where: { id: paymentId },
        select: { id: true, checkStatus: true },
    });

    if (!payment) {
        throw new Error('Staff payment not found');
    }

    if (payment.checkStatus === status) {
        return; // No change needed
    }

    await client.staffPayment.update({
        where: { id: paymentId },
        data: { checkStatus: status },
    });

    // Rebuild ledger with new status
    if (tx) {
        await rebuildStaffPaymentLedger(tx, paymentId);
    } else {
        await prisma.$transaction(async (txn) => {
            await rebuildStaffPaymentLedger(txn, paymentId);
        });
    }
}
